(() => {
  const sharedNamespace = globalThis.ToxicShieldShared || {};
  const labels = sharedNamespace.LABELS || [
    "toxic",
    "severe_toxic",
    "obscene",
    "threat",
    "insult",
    "identity_hate",
  ];

  const blockLabels = new Set(["severe_toxic", "threat"]);
  const highProbabilityBlockThreshold = 0.8;

  function sigmoid(value) {
    if (value >= 0) {
      const z = Math.exp(-value);
      return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
  }

  function probabilitiesFromLogits(logits) {
    return Object.fromEntries(labels.map((label, index) => [label, sigmoid(logits[index])]));
  }

  function decideModeration(probabilities, thresholds) {
    const flaggedLabels = labels.filter((label) => {
      const threshold = Number(thresholds[label] ?? 0.5);
      return Number(probabilities[label] ?? 0) >= threshold;
    });
    const highestLabel = labels.reduce((best, label) => {
      return Number(probabilities[label] ?? 0) > Number(probabilities[best] ?? 0) ? label : best;
    }, labels[0]);
    const highestScore = Number(probabilities[highestLabel] ?? 0);
    const flagged = flaggedLabels.length > 0;
    const shouldBlock =
      flaggedLabels.some((label) => blockLabels.has(label)) ||
      highestScore >= highProbabilityBlockThreshold;

    if (shouldBlock) {
      return {
        flagged,
        flaggedLabels,
        highestLabel,
        highestScore,
        riskLevel: "high",
        action: "block",
      };
    }
    if (flagged) {
      return {
        flagged,
        flaggedLabels,
        highestLabel,
        highestScore,
        riskLevel: "medium",
        action: "review",
      };
    }
    return {
      flagged: false,
      flaggedLabels: [],
      highestLabel,
      highestScore,
      riskLevel: "low",
      action: "allow",
    };
  }

  const exportsObject = {
    LABELS: labels,
    sigmoid,
    probabilitiesFromLogits,
    decideModeration,
  };

  if (typeof module !== "undefined") {
    module.exports = exportsObject;
  }

  if (typeof globalThis !== "undefined") {
    globalThis.ToxicShieldShared = exportsObject;
  }
})();
