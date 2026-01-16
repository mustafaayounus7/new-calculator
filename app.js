// Local-only calculator. Implements the extracted logic pattern.
// Note: This is the same structure as the extracted JS: baseline CC mins, refi amortization, freed cash, allocation, horizon buckets.

const fmt = (n) => {
  if (!isFinite(n)) return '$0';
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
};

function pmt(r, n, p) {
  if (n === 0) return NaN;
  if (r === 0) return -(p / n);
  const pv = Math.pow(1 + r, n);
  return (r / (pv - 1)) * -(p * pv);
}

function amortizeMonths(balance, rateMonthly, payment, maxMonths = 2000) {
  let months = 0, bal = balance, totalInterest = 0;
  if (bal <= 0) return { months: 0, totalInterest: 0, interestByMonth: [] };

  const interestByMonth = [];
  if (rateMonthly > 0 && payment <= rateMonthly * bal) {
    return { months: Infinity, totalInterest: Infinity, interestByMonth };
  }

  while (bal > 0.01 && months < maxMonths) {
    const interest = bal * rateMonthly;
    totalInterest += interest;
    interestByMonth.push(interest);

    const principal = Math.min(payment - interest, bal);
    if (principal <= 0 && rateMonthly > 0) {
      return { months: Infinity, totalInterest: Infinity, interestByMonth };
    }
    bal = Math.max(0, bal - Math.max(0, principal));
    months++;
  }
  return { months, totalInterest, interestByMonth };
}

function baselineCC(totalDebt, aprPct, maxMonths = 2000) {
  const cmr = (aprPct / 100) / 12;
  let bal = totalDebt;
  let totalInterest = 0;
  const interestByMonth = [];
  let months = 0;

  for (let m = 1; m <= maxMonths; m++) {
    if (bal <= 0.01) break;

    const minPay = Math.max(bal * 0.025, 25);
    const interest = bal * cmr;
    totalInterest += interest;
    interestByMonth.push(interest);

    const principal = Math.min(minPay - interest, bal);
    if (principal <= 0 && cmr > 0) { months = Infinity; break; }

    bal = Math.max(0, bal - Math.max(0, principal));
    months = m;
  }
  return { months, totalInterest, interestByMonth, cmr };
}

function getNum(id) {
  return parseFloat(document.getElementById(id).value) || 0;
}

function simulateBuckets(months, payoffMonths, invMonthly, epMonthly, emMonthly, savMonthly, invRatePct, savRatePct) {
  const imr = (invRatePct / 100) / 12;
  const smr = (savRatePct / 100) / 12;
  let invest = 0, emergency = 0, savings = 0;

  for (let m = 1; m <= months; m++) {
    invest = invest * (1 + imr) + invMonthly;
    emergency = emergency * (1 + smr) + emMonthly;

    const stillPaying = m <= payoffMonths;
    const savContrib = savMonthly + (stillPaying ? 0 : epMonthly);
    savings = savings * (1 + smr) + savContrib;
  }
  return { invest, emergency, savings };
}

function sumFirstN(arr, n) {
  let s = 0;
  const lim = Math.min(n, arr.length);
  for (let i = 0; i < lim; i++) s += arr[i];
  return s;
}

function calc() {
  const totalDebt = getNum('totalDebt');
  const currentAPR = getNum('currentAPR');
  const currentPayment = getNum('currentPayment');

  const addDollar = getNum('additionalCashFlow');
  const addPct = getNum('additionalCashFlowPct');

  const newAPR = getNum('newAPR');
  const newTermYears = getNum('newTerm');
  const refiCosts = getNum('refiCosts');

  const pctEP = getNum('extraPrincipal') / 100;
  const pctInv = getNum('investing') / 100;
  const pctEm = getNum('emergencyFund') / 100;
  const pctSav = getNum('savingsBuckets') / 100;

  const invReturn = getNum('investmentReturn');
  const savReturn = getNum('savingsReturn');

  // Baseline CC (minimums)
  const base = baselineCC(totalDebt, currentAPR);

  // New loan
  const loanAmount = totalDebt + refiCosts;
  const nmr = (newAPR / 100) / 12;
  const ntm = Math.max(0, Math.round(newTermYears * 12));
  const scheduled = (ntm > 0) ? -pmt(nmr, ntm, loanAmount) : 0;

  // Freed cash (same order as extracted JS)
  const baseCFC = currentPayment - scheduled;
  const baseForPct = Math.max(baseCFC + addDollar, 0);
  const cf = baseCFC + addDollar + (baseForPct * (addPct / 100));

  // Allocation (auto-scale)
  const sumPct = (pctEP + pctInv + pctEm + pctSav) || 1;
  const epMonthly = Math.max(0, cf * (pctEP / sumPct));
  const invMonthly = Math.max(0, cf * (pctInv / sumPct));
  const emMonthly = Math.max(0, cf * (pctEm / sumPct));
  const savMonthly = Math.max(0, cf * (pctSav / sumPct));

  // New payoff
  const actualPayment = Math.max(0, scheduled + epMonthly);
  const refi = amortizeMonths(loanAmount, nmr, actualPayment);
  const payoffMonths = isFinite(refi.months) ? refi.months : 0;

  // Interest saved (total) = baseline total interest - refi total interest
  const interestSavedTotal = (isFinite(base.totalInterest) ? base.totalInterest : 0) - (isFinite(refi.totalInterest) ? refi.totalInterest : 0);

  // Account growth (at payoff)
  const bucketsAtPayoff = simulateBuckets(payoffMonths, payoffMonths, invMonthly, epMonthly, emMonthly, savMonthly, invReturn, savReturn);
  const accountGrowth = bucketsAtPayoff.invest + bucketsAtPayoff.savings; // investing + savings only

  const totalImpact = interestSavedTotal + accountGrowth;

  // UI updates
  document.getElementById('cashFlowAmount').textContent = fmt(cf);
  document.getElementById('monthlyExtraPrincipal').textContent = fmt(epMonthly);
  document.getElementById('monthlyInvesting').textContent = fmt(invMonthly);
  document.getElementById('monthlyEmergency').textContent = fmt(emMonthly);
  document.getElementById('monthlySavings').textContent = fmt(savMonthly);

  // Horizons
  const horizons = [
    { m: 3, impactId: 'impact90days' },
    { m: 6, impactId: 'impact6months' },
    { m: 12, impactId: 'impact1year' },
    { m: 36, impactId: 'impact3years' },
    { m: 60, impactId: 'impact5years' },
  ];

  function bucketFor(m) {
    const sim = simulateBuckets(m, payoffMonths, invMonthly, epMonthly, emMonthly, savMonthly, invReturn, savReturn);

    const epCum = epMonthly * Math.min(m, payoffMonths);
    const baseInt = sumFirstN(base.interestByMonth, m);
    const newInt = sumFirstN(refi.interestByMonth, m);
    const iSaved = baseInt - newInt;

    const t = epCum + sim.invest + sim.emergency + sim.savings + iSaved;
    return { epCum, sim, iSaved, total: t };
  }

  const b6 = bucketFor(6);
  const b12 = bucketFor(12);
  const b36 = bucketFor(36);
  const b60 = bucketFor(60);

  // Impacts
  for (const h of horizons) {
    const b = bucketFor(h.m);
    document.getElementById(h.impactId).textContent = fmt(b.total);
  }

  // Where money goes
  const set = (id, v) => document.getElementById(id).textContent = fmt(v);

  set('principal6mo', b6.epCum); set('principal1yr', b12.epCum); set('principal3yr', b36.epCum); set('principal5yr', b60.epCum);
  set('investing6mo', b6.sim.invest); set('investing1yr', b12.sim.invest); set('investing3yr', b36.sim.invest); set('investing5yr', b60.sim.invest);
  set('emergency6mo', b6.sim.emergency); set('emergency1yr', b12.sim.emergency); set('emergency3yr', b36.sim.emergency); set('emergency5yr', b60.sim.emergency);
  set('savings6mo', b6.sim.savings); set('savings1yr', b12.sim.savings); set('savings3yr', b36.sim.savings); set('savings5yr', b60.sim.savings);

  set('interestSaved6mo', b6.iSaved); set('interestSaved1yr', b12.iSaved); set('interestSaved3yr', b36.iSaved); set('interestSaved5yr', b60.iSaved);
  set('totalFreed6mo', b6.total); set('totalFreed1yr', b12.total); set('totalFreed3yr', b36.total); set('totalFreed5yr', b60.total);

  // Debt-free date display
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + Math.round(payoffMonths), 1);
  document.getElementById('debtFreeDate').textContent = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  document.getElementById('monthsToPayoff').textContent = (payoffMonths / 12).toFixed(1);

  // Bottom metrics
  document.getElementById('interestSaved').textContent = fmt(interestSavedTotal);
  const timeSavedYears = ((isFinite(base.months) ? base.months : 0) - payoffMonths) / 12;
  document.getElementById('timeSaved').textContent = timeSavedYears.toFixed(1) + ' years';

  document.getElementById('investmentGrowth').textContent = fmt(accountGrowth);
  document.getElementById('investmentGrowthBreakdown').textContent = 'Investing: ' + fmt(bucketsAtPayoff.invest) + ' • Savings: ' + fmt(bucketsAtPayoff.savings);

  document.getElementById('totalImpact').textContent = fmt(totalImpact);
}

document.querySelectorAll('input').forEach(el => el.addEventListener('input', calc));
calc();
