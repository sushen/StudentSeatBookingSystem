import { CHART_COLORS } from "../utils/constants.js";

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: {
      labels: {
        color: CHART_COLORS.text,
        boxWidth: 10,
        usePointStyle: true
      }
    },
    tooltip: {
      displayColors: false
    }
  },
  scales: {
    x: {
      ticks: { color: CHART_COLORS.textMuted, maxRotation: 0, autoSkip: true },
      grid: { color: CHART_COLORS.lineGrid }
    },
    y: {
      beginAtZero: true,
      ticks: { color: CHART_COLORS.textMuted },
      grid: { color: CHART_COLORS.lineGrid }
    }
  }
};

function makeLineConfig(learning) {
  return {
    type: "line",
    data: {
      labels: learning.trend.labels,
      datasets: [
        {
          label: "Active Learners",
          data: learning.trend.activeLearners,
          borderColor: CHART_COLORS.blue,
          backgroundColor: "rgba(94, 161, 255, 0.15)",
          tension: 0.28,
          borderWidth: 2,
          fill: true,
          pointRadius: 2
        },
        {
          label: "Lesson Updates",
          data: learning.trend.updates,
          borderColor: CHART_COLORS.cyan,
          backgroundColor: "rgba(93, 230, 217, 0.08)",
          tension: 0.28,
          borderWidth: 2,
          fill: false,
          pointRadius: 1.5
        }
      ]
    },
    options: baseOptions
  };
}

function makeBarConfig(learning) {
  return {
    type: "bar",
    data: {
      labels: learning.activeByPhase.map((item) => item.label),
      datasets: [
        {
          label: "Active Learners (7d)",
          data: learning.activeByPhase.map((item) => item.activeLearners),
          borderRadius: 6,
          backgroundColor: ["#5EA1FF", "#7C8CFF", "#A98DFF", "#5DE6D9", "#44D483", "#F5B24A"]
        }
      ]
    },
    options: {
      ...baseOptions,
      plugins: {
        ...baseOptions.plugins,
        legend: { display: false }
      }
    }
  };
}

function makeDonutConfig(students) {
  const completed = students.filter((student) => student.overallProgressPercent >= 100).length;
  const atRisk = students.filter((student) => student.riskLevel === "high").length;
  const onTrack = Math.max(students.length - completed - atRisk, 0);

  return {
    type: "doughnut",
    data: {
      labels: ["Completed", "On Track", "At Risk"],
      datasets: [
        {
          data: [completed, onTrack, atRisk],
          backgroundColor: [CHART_COLORS.green, CHART_COLORS.blue, CHART_COLORS.red],
          borderWidth: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: CHART_COLORS.text, boxWidth: 10 }
        }
      }
    }
  };
}

export function renderLearningCharts(registry, elements, model) {
  registry.upsert(elements.learningTrendCanvas, makeLineConfig(model.learning));
  registry.upsert(elements.activeByPhaseCanvas, makeBarConfig(model.learning));
  registry.upsert(elements.learningDistributionCanvas, makeDonutConfig(model.students));
}
