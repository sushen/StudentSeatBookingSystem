import { CHART_COLORS } from "../utils/constants.js";

export function renderReferralCharts(registry, elements, referrals) {
  const growthConfig = {
    type: "line",
    data: {
      labels: referrals.growth.labels,
      datasets: [
        {
          label: "Invites",
          data: referrals.growth.joined,
          borderColor: CHART_COLORS.violet,
          backgroundColor: "rgba(169, 141, 255, 0.14)",
          fill: true,
          borderWidth: 2,
          tension: 0.3
        },
        {
          label: "Conversions",
          data: referrals.growth.converted,
          borderColor: CHART_COLORS.green,
          backgroundColor: "rgba(68, 212, 131, 0.08)",
          fill: false,
          borderWidth: 2,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: CHART_COLORS.text, boxWidth: 10 }
        }
      },
      scales: {
        x: {
          ticks: { color: CHART_COLORS.textMuted, maxRotation: 0 },
          grid: { color: CHART_COLORS.lineGrid }
        },
        y: {
          beginAtZero: true,
          ticks: { color: CHART_COLORS.textMuted },
          grid: { color: CHART_COLORS.lineGrid }
        }
      }
    }
  };

  const converted = referrals.totalConversions;
  const nonConverted = Math.max(referrals.totalInvites - referrals.totalConversions, 0);
  const conversionConfig = {
    type: "doughnut",
    data: {
      labels: ["Converted", "Not Converted"],
      datasets: [
        {
          data: [converted, nonConverted],
          backgroundColor: [CHART_COLORS.green, CHART_COLORS.slate],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: CHART_COLORS.text, boxWidth: 10 }
        }
      }
    }
  };

  registry.upsert(elements.referralGrowthCanvas, growthConfig);
  registry.upsert(elements.referralConversionCanvas, conversionConfig);
}
