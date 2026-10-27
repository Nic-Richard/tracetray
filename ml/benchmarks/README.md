# ML benchmarks

Run from `ml/` with `requirements.txt` installed and Node available:

```sh
python -m benchmarks --fast
python -m benchmarks --output benchmarks/results.json
```

The fast run is in CI: 400 visits per dataset, four shuffled-label seeds per
device and three seeds for the other cases. The full run uses 800 visits,
200 shuffled-label seeds per device and ten seeds for the other cases.
`--seeds` and `--shuffle-seeds` override those counts. The suite exits nonzero
if a required case fails, while still reporting all results.

For comparable local runs, set `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS` and
`MKL_NUM_THREADS` to `1`, as CI does. The saved report includes library versions.
It contains aggregate results only. No database, credentials, network, paid
API or saved analysis is involved.

## What is checked

| Case | Data and expected result |
| --- | --- |
| Shuffled labels | Shuffle goal outcomes independently of pre-goal behaviour on both devices. No findings in any run. |
| Whole visits versus matched windows | Goal actions and later behaviour are informative only in the whole-visit totals. Whole-visit AUC exceeds 0.8, while pre-goal AUC stays below 0.65. This is a deliberately strong leakage control, not an estimate of the size of real-world leakage. |
| Behaviour after conversion | The same post-conversion signals can't produce findings when the pre-goal windows are used. |
| Empty pre-goal windows | A visit that ended or converted before a usable window can't fall back to its whole-visit totals. No findings. |
| Known pre-goal signal | Deeper scrolling before conversion is recovered with the higher direction on both devices. |
| Three planted groups | Three separated patterns in click rate, cursor speed and scroll depth are recovered with adjusted Rand index at least 0.8. |
| No real groups | One noisy population, including scroll-only visits and random goal outcomes, returns no reliable groups. |
| Gradual behaviour | One smooth bounded range across correlated measures must not receive a clear-groups verdict. |
| Tracking, independent samples | Two independently generated samples from the same three-group population keep group identities, with no false new groups or wrong matches. |
| Tracking, overlapping samples | Two samples sharing half their visits keep group identities under the same checks. |
| Missing-value seeds | Change only the random fill seed, holding the visits and k-means seed fixed. Mean adjusted Rand index must be at least 0.8 and mean switched membership at most 10%. Also report switches specifically among visits with missing measures. |

Grouping cases use desktop measures. Goal-model cases cover both devices.
The tracking checks call the actual server `trackGroups` function through
`tracking.cjs`; they don't reimplement its matching rule in Python.

The membership-switch count aligns labels by the best one-to-one match, so
renumbering alone isn't counted as a switch. The full run uses five fill seeds
per dataset; the fast run uses two. Regression limits are practical checks for
large changes, not confidence levels or proof that groups are natural types.

## Problems found while rebuilding the checks

In the first fast run, all three empty-window cases produced false findings.
The model treated empty window metadata as permission to use the whole visit.
It now respects the presence of window metadata and abstains when none is
usable. Legacy datasets without window metadata can still describe whole-visit
associations; those aren't pre-goal predictions.

The same first run called the smooth bounded range clear groups in all three
seeds. A Gaussian reference alone was too easy to beat. The clustering check
now compares against both Gaussian and bounded uniform clouds with the data's
covariance. The bounded reference corrected this case without changing the
local demo's three desktop and four mobile groups or their clear verdicts.
It doesn't rule out all possible false groups, such as curved continuous shapes.

An earlier three-persona fixture had overlapping measured behaviour. Letting
the model choose two groups gave mean ARI 0.5975 across three fast seeds;
forcing three gave 0.5228. That fixture remains in the report as
`overlapping_personas`, a diagnostic without a recovery assertion. The required
three-group recovery test uses distinct patterns that can be separated in the
recorded measures. Neither test establishes that visitor intentions are known.

## Reading the report

`results.json` records observed false-finding and false-group rates, recovery
rates, tracking errors and membership changes across seeds. Zero observed
failures isn't a guarantee of zero failures on other distributions or real sites.
The overlapping-persona result stays visible even when all required cases pass.

Full run on Oct 27, 2026:

| Check | Observed result |
| --- | --- |
| Shuffled labels | 0 findings in 400 runs, using 200 seeds per device; AUC 0.4045 to 0.5776 |
| Whole visits versus windows | Whole-visit AUC 1.0; pre-goal AUC 0.4266 to 0.5594 across 20 controls |
| Post-conversion signals and empty windows | 0 findings in 20 runs each |
| Known pre-goal signal | Right feature and direction in 20/20 runs |
| Separated planted groups | ARI 1.0 in 10/10 datasets |
| No-group and gradual data | No reliable groups in 10/10 datasets each |
| Independent and overlapping tracking | 0 false new groups and 0 wrong matches out of 30 groups each |
| Changing the fill seed | Mean ARI 0.9513; mean switched share 1.23%, at most 2.0%; mean 5.29% among visits with missing measures |
| Overlapping personas | Mean ARI 0.6305 with the chosen count, 0.5303 when forced to three |
