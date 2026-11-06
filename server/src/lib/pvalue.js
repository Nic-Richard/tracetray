// Two-sided normal p-value (Abramowitz and Stegun 26.2.17).
function twoSided(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const tail = 0.3989423 * Math.exp(-z * z / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return 2 * tail;
}

module.exports = { twoSided };
