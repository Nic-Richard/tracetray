import { useState } from "react";
import { useSignIn } from "@clerk/expo";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../lib/theme";
import Brand from "../../components/Brand";
import Icon from "../../components/Icon";

export default function SignIn() {
  const { startHostedAuth } = useHostedAuth();
  const { signIn } = useSignIn();
  const { styles, colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState<"email" | "totp" | null>(null);
  function check(result: { error: { message: string } | null }) {
    if (result.error) throw new Error(result.error.message);
  }
  async function finish() {
    if (signIn.status === "complete") {
      check(await signIn.finalize());
      return;
    }
    if (["needs_client_trust", "needs_second_factor"].includes(signIn.status)) {
      if (signIn.supportedSecondFactors.some(factor => factor.strategy === "email_code")) {
        check(await signIn.mfa.sendEmailCode());
        setVerification("email");
        return;
      }
      if (signIn.supportedSecondFactors.some(factor => factor.strategy === "totp")) {
        setVerification("totp");
        return;
      }
    }
    setError("Use more sign-in options to finish signing in to this account.");
  }
  async function submit() {
    if (busy || (verification ? code.length !== 6 : !email.trim() || !password)) return;
    setBusy(true);
    setError("");
    try {
      if (verification) {
        check(await (verification === "email" ? signIn.mfa.verifyEmailCode({ code }) : signIn.mfa.verifyTOTP({ code })));
      } else {
        check(await signIn.password({ emailAddress: email.trim(), password }));
        setPassword("");
      }
      await finish();
    } catch (err) { setError(err instanceof Error ? err.message : "Sign-in didn't finish. Try again."); }
    finally { setBusy(false); }
  }
  async function hosted() {
    if (busy) return;
    setBusy(true);
    setError("");
    try { await startHostedAuth({ mode: "sign-in" }); }
    catch (err) { setError(err instanceof Error ? err.message : "Sign-in didn't finish. Try again."); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { justifyContent: "center", gap: 24, maxWidth: 480 }]}>
      <Brand />
      <View style={{ gap: 10, marginTop: 20 }}><Text style={styles.title}>{verification ? "Verify it's you" : "A closer look at\nyour visitors."}</Text><Text style={styles.muted}>{verification ? "One more step to open your dashboard." : "Sign in to explore your websites, goals and visitor behaviour."}</Text></View>
      <View style={[styles.panel, { padding: 20, gap: 16 }]}>
      {verification ? <>
        <Text style={styles.text}>{verification === "email" ? "Enter the code sent to your email address." : "Enter the code from your authenticator app."}</Text>
        <TextInput accessibilityLabel="Verification code" style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} placeholder="Verification code" placeholderTextColor={colors.muted} onSubmitEditing={submit} />
      </> : <>
        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.muted}>Use your email and password, or choose more sign-in options for Google.</Text>
        <TextInput accessibilityLabel="Email address" style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" placeholder="Email address" placeholderTextColor={colors.muted} />
        <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" placeholder="Password" placeholderTextColor={colors.muted} onSubmitEditing={submit} />
      </>}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy || (verification ? code.length !== 6 : !email.trim() || !password)} style={[styles.button, { opacity: busy || (verification ? code.length !== 6 : !email.trim() || !password) ? 0.45 : 1 }]} onPress={submit}>
        <Text style={styles.buttonText}>{busy ? "Signing in…" : verification ? "Verify" : "Sign in"}</Text>
      </Pressable>
      {verification ? <View style={styles.row}>
        {verification === "email" ? <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
          setBusy(true);
          setError("");
          try { check(await signIn.mfa.sendEmailCode()); } catch (err) { setError(err instanceof Error ? err.message : "Couldn't send another code."); }
          finally { setBusy(false); }
        }} style={{ paddingVertical: 12 }}><Text style={styles.link}>Send a new code</Text></Pressable> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={async () => {
          setBusy(true);
          setError("");
          try { check(await signIn.reset()); setVerification(null); setCode(""); }
          catch (err) { setError(err instanceof Error ? err.message : "Couldn't restart sign-in. Try again."); }
          finally { setBusy(false); }
        }} style={{ paddingVertical: 12 }}><Text style={styles.link}>Start over</Text></Pressable>
      </View> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={hosted} style={styles.secondaryButton}><View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Icon name="account" color={colors.accent} size={19} /><Text style={styles.link}>More sign-in options</Text></View></Pressable>
      </View>
      <View style={[styles.row, { justifyContent: "center", gap: 28 }]}>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL("https://tracetray.com/privacy")}><Text style={styles.link}>Privacy</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL("https://tracetray.com/terms")}><Text style={styles.link}>Terms</Text></Pressable>
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
