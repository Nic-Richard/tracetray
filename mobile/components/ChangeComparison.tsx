import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { COMPARISON_ROWS, COMPARISON_MIN_VISITS, COMPARISON_WAITING, COMPARISON_TRAFFIC_NOTE, comparisonStatus, comparisonGoalSummary, comparisonGroupScope, comparisonPeriods, comparisonRate, comparisonVerdict, percent } from "@tracetray/shared";
import { useApi } from "../lib/api";
import { useLoad } from "../lib/useLoad";
import { useTheme } from "../lib/theme";

export default function ChangeComparison({ site, page, day, change, linked }: { site: string; page: string; day: string; change?: string; linked?: boolean }) {
  const api = useApi();
  const { styles, colors } = useTheme();
  const result = useLoad(() => api.compare(site, page, day, change), [api, site, page, day, change]);
  const data = result.data;
  if (result.error)
    return (
      <View style={styles.panel}>
        <Text style={styles.error} accessibilityRole="alert">
          {result.error}
        </Text>
        <Pressable accessibilityRole="button" onPress={result.reload} style={styles.button}>
          <Text style={styles.buttonText}>Retry comparison</Text>
        </Pressable>
      </View>
    );
  if (!data) return <ActivityIndicator color={colors.accent} accessibilityLabel="Comparing visits" />;
  if (!data.ready || !data.before || !data.after)
    return (
      <View><Text style={styles.muted}>{COMPARISON_WAITING}</Text><Text style={styles.muted}>{comparisonStatus(data)}</Text></View>
    );
  const { before, after, goal, groups } = data;
  const judged = before.visits >= COMPARISON_MIN_VISITS && after.visits >= COMPARISON_MIN_VISITS;
  const mixShift =
    before.phoneShare !== null && after.phoneShare !== null && Math.abs(after.phoneShare - before.phoneShare) >= 0.1;
  function row(label: string, b: string, a: string, change: string, verdict?: string | null) {
    return (
      <View key={label} style={styles.panel}>
        <Text style={styles.heading}>{label}</Text>
        <View style={styles.row}>
          <Text style={styles.text}>Before: {b}</Text>
          <Text style={styles.text}>After: {a}</Text>
        </View>
        <Text
          style={[
            styles.muted,
            { color: verdict === "better" ? colors.good : verdict === "worse" ? colors.danger : colors.muted },
          ]}
        >
          {change}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.text}>
        {data.days} complete {data.days === 1 ? "day" : "days"} on each side of {day}, excluding the change day (UTC):{" "}
        {before.visits.toLocaleString()} visits before, {after.visits.toLocaleString()} after.
      </Text>
      <Text style={styles.muted}>{comparisonPeriods(day, data.days, data.device)}</Text>
      {data.provisional ? <Text style={styles.muted}>Provisional: collecting 14 complete days after the change. No conclusion yet.</Text> : null}
      {comparisonStatus(data) ? <Text style={styles.muted}>{comparisonStatus(data)}</Text> : null}
      <Text style={styles.muted}>{COMPARISON_TRAFFIC_NOTE}</Text>
      {goal ? <Text style={styles.text}>{comparisonGoalSummary(goal)}</Text> : null}
      {goal ? <Text style={styles.muted}>Goal completions: {goal.before_reached} before; {goal.after_reached} after.</Text> : null}
      {goal ? (
        row(
          `Reached ${goal.name}`,
          comparisonRate(goal.before),
          comparisonRate(goal.after),
          goal.verdict === "unclear"
            ? "Inconclusive"
            : goal.verdict === "same"
              ? "No clear difference"
              : goal.verdict === "better"
                ? "Higher rate"
                : "Lower rate",
          goal.verdict,
        )
      ) : (
        <Text style={styles.muted}>No comparable goal rates are available for this record.</Text>
      )}
      {COMPARISON_ROWS.map(measure => {
        const b = before[measure.key],
          a = after[measure.key];
        if (b === null || a === null) return null;
        const verdict = judged ? comparisonVerdict(measure, b, a) : null;
        const delta = b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%` : "No relative change available";
        return row(
          measure.label,
          measure.format(b),
          measure.format(a),
          verdict === "same"
            ? "Little change"
            : verdict === "better"
              ? "Rose"
              : verdict === "worse"
                ? "Fell"
                : delta,
          verdict,
        );
      })}
      {goal?.verdict === "unclear" ? (
        <Text style={styles.muted}>
          A direction is reported after 14 complete days, with at least 30 visits on each side and 30 goal completions across both ({goal.reached} so far). Otherwise the result stays inconclusive.
        </Text>
      ) : null}
      <Text style={styles.muted}>
        Scroll depth and clicks don't get a verdict because either direction can be good: shallower scrolling or fewer
        clicks can mean people find what they need sooner, or that they give up earlier.
      </Text>
      <Text style={styles.muted}>Other measures show observed changes only; their labels don't include a statistical uncertainty test.</Text>
      {!judged ? (
        <Text style={styles.muted}>
          Fewer than {COMPARISON_MIN_VISITS} visits on one side, so these differences could easily be chance. They get
          more reliable as visits come in.
        </Text>
      ) : null}
      {judged && mixShift ? (
        <Text style={styles.muted}>
          The share of visits on phones moved from {percent(before.phoneShare)} to {percent(after.phoneShare)}. Phone
          visitors tap and scroll differently, so that alone can move these numbers.
        </Text>
      ) : null}
      {!linked ? <View style={styles.panel}>
        <Text style={styles.heading}>Visitor groups</Text>
        <Text style={styles.muted}>Group snapshots use their own analysis periods and may overlap. They don't isolate visits before and after this change.</Text>
        {groups?.before ? <Text style={styles.muted}>Before snapshot: {comparisonGroupScope(groups.before_scope)}</Text> : null}
        {groups?.after ? <Text style={styles.muted}>After snapshot: {comparisonGroupScope(groups.after_scope)}</Text> : null}
        {groups?.before && groups.after ? (
          groups.after.map(group => {
            const previous = groups.before!.find(value => value.group === group.group)?.share;
            return (
              <Text key={group.group} style={styles.text}>
                {group.group}: {previous === undefined ? "new" : percent(previous)} → {percent(group.share)}
              </Text>
            );
          })
        ) : (
          <Text style={styles.muted}>
            {groups?.after
              ? "There's no analysis from before this change, so groups can't be compared."
              : "Refresh the analysis to see how the visitor groups changed."}
          </Text>
        )}
      </View> : null}
    </View>
  );
}
