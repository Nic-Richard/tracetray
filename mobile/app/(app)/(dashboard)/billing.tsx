import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PLAN_NAMES } from "@tracetray/shared";
import { useApi } from "../../../lib/api";
import { useLoad } from "../../../lib/useLoad";
import { useTheme } from "../../../lib/theme";
import { Failure, Loading } from "../../../components/Status";

const statuses: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment overdue",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Payment incomplete",
  incomplete_expired: "Expired",
  paused: "Paused",
};
const formatDate = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "Unavailable";
const allowance = (value: number | null, singular: string, plural: string) =>
  value === null ? `Unlimited ${plural}` : `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

export default function BillingScreen() {
  const api = useApi();
  const { styles, colors } = useTheme();
  const result = useLoad(() => api.usage(), [api]);
  if (result.error) return <Failure message={result.error} retry={result.reload} />;
  if (!result.data) return <Loading />;
  const data = result.data;
  const sub = data.subscription;
  return (
    <SafeAreaView style={styles.screen} edges={["left", "right", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={result.loading} onRefresh={result.reload} tintColor={colors.accent} />
        }
      >
        <View style={styles.panel}>
          <Text style={styles.heading}>{data.mode === "beta" ? "TraceTray beta" : PLAN_NAMES[data.plan]}</Text>
          {data.mode === "beta" ? (
            <Text style={styles.text}>The beta has no subscription limits.</Text>
          ) : sub ? (
            <>
              <Text style={styles.text}>
                {statuses[sub.status] || "Subscription status unavailable"}
                {sub.interval === "month" ? " · Monthly billing" : sub.interval === "year" ? " · Yearly billing" : ""}
              </Text>
              {sub.status === "trialing" && sub.trial_end ? (
                <Text style={styles.muted}>Trial ends {formatDate(sub.trial_end)}</Text>
              ) : null}
              {sub.current_period_end ? (
                <Text style={styles.muted}>
                  {sub.cancel_at_period_end
                    ? "Cancellation scheduled for"
                    : sub.status === "active" || sub.status === "trialing"
                      ? "Current billing period ends"
                      : "Last billing period ended"}{" "}
                  {formatDate(sub.current_period_end)}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.muted}>
              {sub === undefined
                ? "Subscription details couldn't be loaded. Pull down to try again."
                : "No subscription on this account."}
            </Text>
          )}
          <Text style={styles.text}>To change your plan or billing details, use TraceTray on the web.</Text>
        </View>
        <View style={styles.panel}>
          <Text style={styles.heading}>This month's usage</Text>
          <Text style={styles.text}>
            {data.usage.visits.toLocaleString()} visits · {data.usage.pages.toLocaleString()} tracked pages
          </Text>
          <Text style={styles.text}>
            {data.usage.sites.toLocaleString()} websites · {data.usage.askQuestions.toLocaleString()} Ask questions
          </Text>
          <Text style={styles.muted}>Visits, pages and Ask questions reset on the 1st (UTC).</Text>
        </View>
        {data.plans?.length ? <Text style={styles.heading}>Plan allowances</Text> : null}
        {data.plans?.map(plan => (
          <View
            key={plan.id}
            style={[styles.panel, plan.id === data.plan && data.mode !== "beta" ? { borderColor: colors.accent } : {}]}
          >
            <Text style={styles.heading}>
              {PLAN_NAMES[plan.id]}
              {plan.id === data.plan && data.mode !== "beta" ? " · Current plan" : ""}
            </Text>
            <Text style={styles.text}>{allowance(plan.limits.visits, "visit", "visits")} per month</Text>
            <Text style={styles.muted}>
              {allowance(plan.limits.pages, "tracked page", "tracked pages")} ·{" "}
              {allowance(plan.limits.sites, "website", "websites")}
            </Text>
            <Text style={styles.muted}>
              {allowance(plan.limits.askQuestions, "Ask question", "Ask questions")} per month
            </Text>
            <Text style={styles.muted}>
              {plan.limits.historyDays === null
                ? "Unlimited history"
                : `${plan.limits.historyDays.toLocaleString()} days of history`}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
