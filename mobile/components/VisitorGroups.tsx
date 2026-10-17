import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  alikeNote, analysisAdvice, deviceAnalysis, deviceAverages, deviceGoal, groupColorSlots,
  inactiveVisits, INACTIVE_TEXT, percent, visitCount, visitorIntro, visitorTypes,
  type AnalysisResult, type Device
} from "@tracetray/shared";
import { useTheme } from "../lib/theme";
import TraitBars from "./TraitBars";

const rate = (value: number) => percent(value, value > 0 && value < 0.01 ? 1 : 0);

export function Suggestions({ result }: { result: AnalysisResult }) {
  const { styles } = useTheme();
  const advice = analysisAdvice(result);
  if (!advice.length) return null;
  return <View style={styles.panel}>
    <Text style={styles.heading}>What to try</Text>
    {advice.map((item, index) => <View key={`${item.device}:${item.group}:${index}`} style={{ gap: 6, marginTop: 8 }}>
      <Text style={styles.text}>{item.action}</Text>
      <Text style={styles.muted}>{item.evidence}</Text>
    </View>)}
  </View>;
}

export default function VisitorGroups({ result }: { result: AnalysisResult }) {
  const { colors, styles } = useTheme();
  const [device, setDevice] = useState<Device>(visitCount(result, "desktop") ? "desktop" : "mobile");
  const source = deviceAnalysis(result, device);
  const types = visitorTypes(result, device);
  const slots = groupColorSlots(types.map(type => type.key));
  const alike = alikeNote(result, device);
  const inactive = inactiveVisits(result, device);
  const goal = deviceGoal(result, device);
  const averages = deviceAverages(result, device);
  return <View style={{ gap: 14 }}>
    <Text style={styles.heading}>Who visits</Text>
    <View style={[styles.row, { justifyContent: "flex-start" }]} accessibilityRole="tablist">
      {(["desktop", "mobile"] as const).map(value => <Pressable key={value} accessibilityRole="tab"
        accessibilityState={{ selected: device === value, disabled: visitCount(result, value) === 0 }}
        disabled={visitCount(result, value) === 0} onPress={() => setDevice(value)}
        style={[styles.panel, { minHeight: 48, paddingVertical: 12, borderColor: device === value ? colors.accent : colors.line, opacity: visitCount(result, value) ? 1 : 0.5 }]}>
        <Text style={device === value ? styles.link : styles.muted}>{value === "mobile" ? "Mobile" : "Desktop"}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.muted}>{visitorIntro(result, device, types.length)}</Text>
    {alike ? <View style={[styles.panel, { borderLeftWidth: 4, borderLeftColor: colors.groups[0] }]}>
      <View style={styles.row}><Text style={[styles.heading, { flex: 1 }]}>Visitors behave alike</Text><Text style={styles.number}>{percent(1 - (inactive?.share || 0))}</Text></View>
      <Text style={styles.muted}>{source?.session_count.toLocaleString()} visits</Text>
      <Text style={styles.text}>{alike}</Text>
      {goal ? <Text style={styles.text}>{rate(goal.rate)} reached {goal.name}</Text> : null}
      {averages.depth != null ? <Text style={styles.muted}>{percent(averages.depth)} of the way down</Text> : null}
      {averages.actions != null ? <Text style={styles.muted}>{(averages.actions * 60).toFixed(1)} {device === "mobile" ? "taps" : "clicks"} a minute</Text> : null}
    </View> : types.length ? types.map((type, index) => {
      const color = colors.groups[slots[index]];
      const story = type.story;
      const summary = story?.summary !== undefined ? story.summary : !story?.traits?.length ? story?.body : "";
      return <View key={type.id} style={[styles.panel, { borderLeftWidth: 4, borderLeftColor: color, gap: 14 }]}>
        <View style={styles.row}><Text style={[styles.heading, { flex: 1 }]}>{type.headline}</Text><Text style={[styles.number, { color }]}>{percent(type.share)}</Text></View>
        <Text style={styles.muted}>{type.sessions.toLocaleString()} visits · of {device} visits</Text>
        {story?.goal ? <View style={{ gap: 4 }}>
          <Text style={[styles.text, { color: story.goal.standing === "above" ? colors.good : story.goal.standing === "below" ? colors.danger : colors.ink }]}>{rate(story.goal.rate)} reached {story.goal.name}</Text>
          <Text style={styles.muted}>{device} average {rate(story.goal.average)}</Text>
        </View> : null}
        {summary ? <Text style={styles.text}>{summary}</Text> : null}
        {story?.traits?.length ? <TraitBars traits={story.traits} color={color} /> : null}
        {story?.suggestions?.length ? <View style={{ gap: 6 }}><Text style={styles.text}>What to try</Text>{story.suggestions.map(suggestion => <Text key={suggestion} style={styles.muted}>{suggestion}</Text>)}</View> : null}
      </View>;
    }) : <View style={styles.panel}><Text style={styles.muted}>{source?.failure?.message || `Not enough ${device} visits yet to sort them into groups.`}</Text></View>}
    {inactive ? <View style={styles.panel}>
      <View style={styles.row}><Text style={[styles.heading, { flex: 1 }]}>Left without interacting</Text><Text style={styles.number}>{percent(inactive.share)}</Text></View>
      <Text style={styles.muted}>{inactive.count.toLocaleString()} visits</Text>
      {inactive.goal ? <Text style={styles.text}>{rate(inactive.goal.rate)} reached {inactive.goal.name}</Text> : null}
      <Text style={styles.muted}>{INACTIVE_TEXT[device]} Some read without touching anything; others left straight away.</Text>
    </View> : null}
  </View>;
}
