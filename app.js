// Local-only calculator. Implements the extracted logic pattern.
// Note: This is the same structure as the extracted JS: baseline CC mins, refi amortization, freed cash, allocation, horizon buckets.

const fmt = (n) => {
  if (!isFinite(n)) return '$0';
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
};

// Chart instances
let charts = {
  cashGrowth: null,
  debtPaydown: null
};

// Calculate future value with compound interest (similar to simulateBuckets but simpler)
function calculateFutureValue(monthlyContribution, annualRate, months) {
  if (months === 0 || monthlyContribution === 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (monthlyRate === 0) return monthlyContribution * months;
  return monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

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
    { m: 120, impactId: 'impact10years' },
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
  const monthsToPayoffYears = payoffMonths / 12;
  const timeSavedYears = 50 - monthsToPayoffYears;
  document.getElementById('timeSaved').textContent = timeSavedYears.toFixed(1) + ' years';

  document.getElementById('investmentGrowth').textContent = fmt(accountGrowth);
  document.getElementById('investmentGrowthBreakdown').textContent = 'Investing: ' + fmt(bucketsAtPayoff.invest) + ' • Savings: ' + fmt(bucketsAtPayoff.savings);

  document.getElementById('totalImpact').textContent = fmt(totalImpact);

  // Update charts
  updateCharts({
    cf,
    epMonthly,
    invMonthly,
    emMonthly,
    savMonthly,
    invReturn,
    savReturn,
    payoffMonths,
    base,
    refi,
    loanAmount,
    totalDebt,
    currentAPR,
    currentPayment,
    newAPR,
    newTermYears
  });

  // Update interest comparison section
  updateInterestComparison({
    totalDebt,
    currentAPR,
    currentPayment,
    loanAmount,
    newAPR,
    base,
    refi,
    payoffMonths,
    scheduled,
    epMonthly
  });
}

// Initialize charts
function initializeCharts() {
  const cashGrowthCanvas = document.getElementById('cashGrowthChart');
  const debtPaydownCanvas = document.getElementById('debtPaydownChart');
  
  if (!cashGrowthCanvas || !debtPaydownCanvas) {
    console.error('Chart canvas elements not found');
    return;
  }
  
  // Destroy existing chart instances
  if (typeof Chart !== 'undefined') {
    if (Chart.getChart(cashGrowthCanvas)) {
      Chart.getChart(cashGrowthCanvas).destroy();
    }
    if (Chart.getChart(debtPaydownCanvas)) {
      Chart.getChart(debtPaydownCanvas).destroy();
    }

    // Cash Growth Over Time Chart
    const cashGrowthCtx = cashGrowthCanvas.getContext('2d');
    charts.cashGrowth = new Chart(cashGrowthCtx, {
      type: 'bar',
      data: {
        labels: ['3 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '4 Yr', '5 Yr'],
        datasets: [
          {
            label: 'Emergency Fund',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: '#cb746b',
          },
          {
            label: 'Investing/Retirement',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: '#f8c4b7',
          },
          {
            label: 'Savings',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: '#8b3534',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: {
                size: window.innerWidth < 480 ? 11 : 12
              },
              padding: window.innerWidth < 480 ? 8 : 15
            }
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              font: {
                size: window.innerWidth < 480 ? 10 : 12
              }
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: {
              callback: function (value) {
                return '$' + value.toLocaleString();
              },
              font: {
                size: window.innerWidth < 480 ? 10 : 12
              }
            }
          }
        }
      }
    });

    // Debt Paydown Comparison Chart
    const debtPaydownCtx = debtPaydownCanvas.getContext('2d');
    charts.debtPaydown = new Chart(debtPaydownCtx, {
      type: 'bar',
      data: {
        labels: ['0', '1 Yr', '2 Yr', '3 Yr', '4 Yr', '5 Yr'],
        datasets: [
          {
            label: 'Credit Card Debt',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: '#8b3534',
            barThickness: window.innerWidth < 480 ? 2 : 10,
          },
          {
            label: 'Debt Reorganization',
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: '#cb746b',
            barThickness: window.innerWidth < 480 ? 2 : 10,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position:'bottom',
            labels: {
              font: {
                size: window.innerWidth < 480 ? 11 : 12
              },
              padding: window.innerWidth < 480 ? 8 : 15
            }
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function (value) {
                return '$' + value.toLocaleString();
              },
              font: {
                size: window.innerWidth < 480 ? 10 : 12
              }
            }
          },
          x: {
            ticks: {
              font: {
                size: window.innerWidth < 480 ? 10 : 12
              }
            }
          }
        }
      }
    });
  }
}

// Update charts with calculated data
function updateCharts(data) {
  if (!charts.cashGrowth || !charts.debtPaydown) return;

  // Cash Growth Over Time Chart
  const cashGrowthLabels = ['3 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '4 Yr', '5 Yr'];
  const cashGrowthMonths = [3, 6, 12, 24, 36, 48, 60];
  
  const emergencyData = cashGrowthMonths.map(months => {
    const maxMonths = data.payoffMonths > 0 
      ? Math.min(months, data.payoffMonths) 
      : months;
    return calculateFutureValue(data.emMonthly, data.savReturn, maxMonths);
  });

  const investingData = cashGrowthMonths.map(months => {
    const maxMonths = data.payoffMonths > 0 
      ? Math.min(months, data.payoffMonths) 
      : months;
    return calculateFutureValue(data.invMonthly, data.invReturn, maxMonths);
  });

  const savingsData = cashGrowthMonths.map(months => {
    const maxMonths = data.payoffMonths > 0 
      ? Math.min(months, data.payoffMonths) 
      : months;
    return calculateFutureValue(data.savMonthly, data.savReturn, maxMonths);
  });

  charts.cashGrowth.data.datasets[0].data = emergencyData;
  charts.cashGrowth.data.datasets[1].data = investingData;
  charts.cashGrowth.data.datasets[2].data = savingsData;
  charts.cashGrowth.update('none');

  // Debt Paydown Comparison Chart
  const maxYears = Math.max(
    Math.ceil((isFinite(data.base.months) ? data.base.months : 0) / 12), 
    Math.ceil(data.payoffMonths / 12),
    40
  ) + 1;
  
  const debtPaydownLabels = [];
  const ccDebtData = [];
  const newLoanData = [];

  // Calculate debt paydown over time for credit card (using minimum payments)
  const ccMonthlyRate = data.currentAPR / 100 / 12;
  let ccRemaining = data.totalDebt;

  // Calculate debt paydown over time for consolidation loan
  const loanMonthlyRate = data.newAPR / 100 / 12;
  const loanMonthlyPayment = (data.newTermYears > 0) ? -pmt(loanMonthlyRate, data.newTermYears * 12, data.loanAmount) : 0;
  const loanExtraPrincipal = data.epMonthly;
  let loanRemaining = data.loanAmount;

  for (let year = 0; year <= Math.min(maxYears, 40); year++) {
    debtPaydownLabels.push(year === 0 ? '0' : `${year} Yr`);
    
    if (year === 0) {
      ccDebtData.push(data.totalDebt);
      newLoanData.push(data.loanAmount);
    } else {
      // Calculate credit card balance at this year (using minimum 2.5% payment)
      for (let month = 0; month < 12 && ccRemaining > 0.01; month++) {
        const minPay = Math.max(ccRemaining * 0.025, 25);
        const interest = ccRemaining * ccMonthlyRate;
        const principal = Math.min(minPay - interest, ccRemaining);
        if (principal > 0) {
          ccRemaining -= principal;
        } else {
          break;
        }
      }
      ccDebtData.push(Math.max(0, ccRemaining));

      // Calculate consolidation loan balance at this year
      for (let month = 0; month < 12 && loanRemaining > 0.01; month++) {
        const interest = loanRemaining * loanMonthlyRate;
        const principal = Math.min(loanMonthlyPayment + loanExtraPrincipal - interest, loanRemaining);
        if (principal > 0) {
          loanRemaining -= principal;
        } else {
          break;
        }
      }
      newLoanData.push(Math.max(0, loanRemaining));
    }
  }

  // Update chart data
  charts.debtPaydown.data.labels = debtPaydownLabels;
  charts.debtPaydown.data.datasets[0].data = ccDebtData;
  charts.debtPaydown.data.datasets[1].data = newLoanData;
  charts.debtPaydown.update('none');
}

// Calculate traditional credit card interest with compounding (using current payment)
function calculateTraditionalInterest(totalDebt, apr, monthlyPayment, maxMonths = 2000) {
  if (monthlyPayment <= 0 || totalDebt <= 0) {
    return { totalInterest: 0, totalPaid: totalDebt, months: 0 };
  }

  const monthlyRate = apr / 100 / 12;
  let balance = totalDebt;
  let totalInterest = 0;
  let months = 0;

  for (let m = 1; m <= maxMonths; m++) {
    if (balance <= 0.01) break;

    // Interest compounds monthly (added to balance each month)
    const interest = balance * monthlyRate;
    totalInterest += interest;
    
    // Apply payment
    const principalPayment = Math.min(monthlyPayment - interest, balance);
    
    if (principalPayment <= 0 && monthlyRate > 0) {
      // Payment doesn't cover interest - debt grows
      return { totalInterest: Infinity, totalPaid: Infinity, months: Infinity };
    }
    
    balance = Math.max(0, balance - principalPayment);
    months = m;
  }

  const totalPaid = totalDebt + totalInterest;
  return { totalInterest, totalPaid, months };
}

// Update interest comparison section
function updateInterestComparison(data) {
  // Calculate traditional method (using current payment)
  const traditional = calculateTraditionalInterest(
    data.totalDebt,
    data.currentAPR,
    data.currentPayment
  );

  // Calculate consolidation loan with SAME monthly payment for fair comparison
  // Use same payment amount but with lower APR
  const consolidationMonthlyRate = data.newAPR / 100 / 12;
  const consolidationComparison = amortizeMonths(
    data.loanAmount,
    consolidationMonthlyRate,
    data.currentPayment
  );
  
  const consolidationTotalInterest = isFinite(consolidationComparison.totalInterest) 
    ? consolidationComparison.totalInterest 
    : 0;
  const consolidationTotalPaid = data.loanAmount + consolidationTotalInterest;
  const consolidationMonths = isFinite(consolidationComparison.months) 
    ? consolidationComparison.months 
    : 0;

  // Update traditional method display
  document.getElementById('traditionalBalance').textContent = fmt(data.totalDebt);
  document.getElementById('traditionalAPR').textContent = data.currentAPR.toFixed(2) + '%';
  document.getElementById('traditionalPayment').textContent = fmt(data.currentPayment);
  
  if (isFinite(traditional.totalInterest)) {
    document.getElementById('traditionalTotalInterest').textContent = fmt(traditional.totalInterest);
    document.getElementById('traditionalTotalPaid').textContent = fmt(traditional.totalPaid);
  } else {
    document.getElementById('traditionalTotalInterest').textContent = 'Never';
    document.getElementById('traditionalTotalPaid').textContent = 'Never';
  }
  
  if (isFinite(traditional.months)) {
    const traditionalYears = (traditional.months / 12).toFixed(1);
    document.getElementById('traditionalTimeToPayoff').textContent = traditionalYears + ' years';
  } else {
    document.getElementById('traditionalTimeToPayoff').textContent = 'Never';
  }

  // Update consolidation method display (using SAME payment as traditional)
  document.getElementById('consolidationBalance').textContent = fmt(data.loanAmount);
  document.getElementById('consolidationAPR').textContent = data.newAPR.toFixed(2) + '%';
  document.getElementById('consolidationPayment').textContent = fmt(data.currentPayment);
  document.getElementById('consolidationTotalInterest').textContent = fmt(consolidationTotalInterest);
  document.getElementById('consolidationTotalPaid').textContent = fmt(consolidationTotalPaid);
  
  const consolidationYears = (consolidationMonths / 12).toFixed(1);
  document.getElementById('consolidationTimeToPayoff').textContent = consolidationYears + ' years';

  // Calculate and display savings
  const interestSaved = isFinite(traditional.totalInterest) 
    ? Math.max(0, traditional.totalInterest - consolidationTotalInterest)
    : 0;
  
  const timeSavedMonths = isFinite(traditional.months) 
    ? Math.max(0, traditional.months - consolidationMonths)
    : 0;
  const timeSavedYears = (timeSavedMonths / 12).toFixed(1);

  document.getElementById('interestComparisonSavings').textContent = fmt(interestSaved);
  document.getElementById('timeComparisonSavings').textContent = timeSavedYears + ' years';

  // Update compounding impact message
  const compoundingMessage = data.currentAPR > data.newAPR
    ? `Lower APR (${data.newAPR}% vs ${data.currentAPR}%) means less interest compounds monthly, saving you money.`
    : 'Lower interest rate reduces compound interest accumulation over time.';
  document.getElementById('compoundingImpact').textContent = compoundingMessage;
}

// Initialize when DOM and Chart.js are ready
function initApp() {
  // Wait a bit for Chart.js to load if it's from CDN
  if (typeof Chart !== 'undefined') {
    initializeCharts();
    document.querySelectorAll('input').forEach(el => el.addEventListener('input', calc));
    calc();
  } else {
    // Retry if Chart.js not loaded yet
    setTimeout(initApp, 100);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  // DOM already loaded
  initApp();
}
