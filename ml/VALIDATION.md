# Goal model validation

Checked Oct 27, 2026 on the local seeded Morrowpine product pages, using the
"Added to cart" goal. These are synthetic demo visits, not customer traffic.
No database records were changed and no paid API was called.

## Preprocessing comparison

Both versions use the same matched-window visits and five stratified folds
(shuffle seed 42). The earlier version fills missing values and standardises
the full dataset before splitting. The corrected version fits those steps
inside each training fold through a scikit-learn Pipeline.

| Device | Window | Visits | Before AUC | After AUC | Difference |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | First 20 seconds | 935 | 0.8221 | 0.8222 | +0.0001 |
| Mobile | First 10 seconds | 569 | 0.7851 | 0.7878 | +0.0027 |

The fix didn't reduce AUC on this dataset. The small changes also reflect
missing values now being drawn from each training fold's observations.
This doesn't establish that the earlier validation was unbiased on other data.

## Earlier versus later visits

The split uses visit start times: roughly the earliest 80% for training and
the latest 20% for testing. Visits sharing the cutoff time stay together in
the later set. The observation window is chosen from training visits only,
then applied unchanged to both sides. Filling and scaling use training data only.

The full model and baseline are tested on exactly the same later visits.
The baseline uses clicks per second on desktop or taps per second on mobile,
plus scroll depth. An AUC of 0.5 is chance-level ranking; this isn't an
estimate of conversion lift.

| Device | Window | Training visits | Later visits | Full AUC | Baseline AUC | Difference |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Desktop | First 20 seconds | 749 | 186 | 0.7807 | 0.5514 | +0.2292 |
| Mobile | First 10 seconds | 459 | 110 | 0.7761 | 0.6255 | +0.1506 |

Differences are calculated before rounding the component scores. No confidence
interval or statistical test of the full-versus-baseline difference is claimed.
These results support further testing of the model on this demo; they don't
establish useful findings on real sites.

The later check needs at least 40 goal-reaching and 40 non-reaching training
visits, and 20 of each in the later set. When those counts are available,
a later AUC below 0.65 holds back the findings even if shuffled cross-validation
passes. Missing timestamps, tied times without a split and insufficient counts
are recorded explicitly; none is reported as a successful later check.

The final descriptive model uses all eligible visits after evaluation. The
later scores evaluate the model, not each displayed driver individually.
The separate visitor-group goal rates remain exploratory.

## Run it again

From `ml/`, with dependencies from `requirements.txt` installed:

```sh
python validate_goal_model.py /path/to/dataset.json GOAL_ID --device desktop
python validate_goal_model.py /path/to/dataset.json GOAL_ID --device mobile
python -m unittest discover -s . -q
```

The comparison script retains the earlier preprocessing method for evaluation
only. It doesn't run collection, save analyses, change records or call an LLM.
New extraction rows include `start_time`; older datasets without it can still
compare cross-validation scores, but can't produce the later-visit scores.
