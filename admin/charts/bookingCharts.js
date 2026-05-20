import { CHART_COLORS } from "../utils/constants.js";

function hasFunnelChartSupport() {
  try {
    if (!window.Chart || !window.Chart.registry || typeof window.Chart.registry.getController !== "function") {
      return false;
    }
    return Boolean(window.Chart.registry.getController("funnel"));
  } catch (error) {
    return false;
  }
}

function makeFunnelConfig(funnel) {
  const labels = funnel.steps.map((step) => step.label);
  const values = funnel.steps.map((step) => step.count);
  const colors = ["#5EA1FF", "#7F8EFF", "#44D483", "#F5B24A", "#FF6C7A"];

  if (hasFunnelChartSupport()) {
    return {
      type: "funnel",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { displayColors: false }
        }
      }
    };
  }

  return {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Bookings",
          data: values,
          backgroundColor: colors,
          borderRadius: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: CHART_COLORS.textMuted },
          grid: { color: CHART_COLORS.lineGrid }
        },
        y: {
          ticks: { color: CHART_COLORS.text },
          grid: { display: false }
        }
      }
    }
  };
}

export function renderBookingFunnelChart(registry, canvas, funnel) {
  registry.upsert(canvas, makeFunnelConfig(funnel));
}
