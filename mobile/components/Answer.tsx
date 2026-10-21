import { Text, View } from "react-native";
import { answerBlocks, answerSpans } from "@tracetray/shared";
import { useTheme } from "../lib/theme";

export default function Answer({ text }: { text: string }) {
  const { styles } = useTheme();
  const inline = (value: string) =>
    answerSpans(value).map((part, index) => (
      <Text key={index} style={part.bold ? { fontFamily: "InstrumentSans_700Bold" } : undefined}>
        {part.text}
      </Text>
    ));
  return (
    <View style={{ gap: 12 }}>
      {answerBlocks(text).map((block, index) =>
        Array.isArray(block) ? (
          <View key={index} style={{ gap: 8 }}>
            {block.map((item, itemIndex) => (
              <View key={itemIndex} style={{ flexDirection: "row", gap: 8 }}>
                <Text style={styles.text}>•</Text>
                <Text style={[styles.text, { flex: 1 }]}>{inline(item)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text key={index} style={styles.text}>
            {inline(block)}
          </Text>
        ),
      )}
    </View>
  );
}
