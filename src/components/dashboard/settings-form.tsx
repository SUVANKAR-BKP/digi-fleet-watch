"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Mail, Send, ShieldAlert, Slack, X } from "lucide-react";
import {
  saveAlertSettings,
  testEmail,
  testSlack,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SettingsView, SettingSource } from "@/lib/settings";

/** Small badge showing whether a value comes from the UI, .env, or nowhere. */
function SourceTag({ source }: { source: SettingSource }) {
  if (source === "unset") return null;
  const label = source === "database" ? "set here" : "from .env";
  return (
    <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
      {label}
    </span>
  );
}

export function SettingsForm({ initial }: { initial: SettingsView }) {
  const router = useRouter();

  const [smtpHost, setSmtpHost] = useState(initial.smtpHost.value);
  const [smtpPort, setSmtpPort] = useState(initial.smtpPort.value || "587");
  const [smtpSecure, setSmtpSecure] = useState(initial.smtpSecure.value);
  const [smtpUser, setSmtpUser] = useState(initial.smtpUser.value);
  const [smtpPass, setSmtpPass] = useState("");
  const [clearSmtpPass, setClearSmtpPass] = useState(false);
  const [mailFrom, setMailFrom] = useState(initial.mailFrom.value);
  const [alertEmailTo, setAlertEmailTo] = useState(initial.alertEmailTo.value);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [clearSlack, setClearSlack] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"email" | "slack" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function reset() {
    setError(null);
    setMessage(null);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setSaving(true);
    const res = await saveAlertSettings({
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      mailFrom,
      alertEmailTo,
      slackWebhookUrl,
      clearSmtpPass,
      clearSlackWebhook: clearSlack,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save settings.");
      return;
    }
    setMessage(res.message ?? "Saved.");
    setSmtpPass("");
    setSlackWebhookUrl("");
    setClearSmtpPass(false);
    setClearSlack(false);
    router.refresh();
  }

  async function runTest(which: "email" | "slack") {
    reset();
    setTesting(which);
    const res = which === "email" ? await testEmail() : await testSlack();
    setTesting(null);
    if (!res.ok) setError(res.error ?? "The test failed.");
    else setMessage(res.message ?? "Test sent.");
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      {!initial.canStoreSecrets && (
        <div className="flex gap-2 rounded-lg border border-security/40 bg-security/10 p-2.5 text-[11px] leading-4 text-security">
          <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Secrets cannot be saved.</strong> Set{" "}
            <code>FLEETWATCH_SESSION_SECRET</code> on the server — it is the key
            used to encrypt the SMTP password and Slack webhook at rest.
          </span>
        </div>
      )}

      {/* Email */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-primary" />
            Email alerts
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testing !== null || saving}
            onClick={() => runTest("email")}
            className="gap-1.5"
          >
            {testing === "email" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send test email
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SMTP host" source={initial.smtpHost.source}>
            <Input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
            />
          </Field>

          <Field label="Port" source={initial.smtpPort.source}>
            <Input
              value={smtpPort}
              onChange={(e) => setSmtpPort(e.target.value)}
              inputMode="numeric"
              placeholder="587"
            />
          </Field>

          <Field label="Username" source={initial.smtpUser.source}>
            <Input
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              autoComplete="off"
              placeholder="alerts@example.com"
            />
          </Field>

          <Field
            label="Password"
            source={initial.smtpPassSet.source}
            hint={
              initial.smtpPassSet.isSet
                ? "A password is stored. Leave blank to keep it."
                : "Not set."
            }
          >
            <div className="flex gap-2">
              <Input
                type="password"
                value={smtpPass}
                onChange={(e) => {
                  setSmtpPass(e.target.value);
                  setClearSmtpPass(false);
                }}
                autoComplete="new-password"
                placeholder={initial.smtpPassSet.isSet ? "••••••••" : ""}
                disabled={clearSmtpPass}
              />
              {initial.smtpPassSet.isSet && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={clearSmtpPass ? "text-down" : "text-muted-foreground"}
                  onClick={() => {
                    setClearSmtpPass((v) => !v);
                    setSmtpPass("");
                  }}
                  title="Clear the stored password"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </Field>

          <Field label="From address" source={initial.mailFrom.source}>
            <Input
              value={mailFrom}
              onChange={(e) => setMailFrom(e.target.value)}
              placeholder='"Digi Fleet Watch" <alerts@example.com>'
            />
          </Field>

          <Field label="Send alerts to" source={initial.alertEmailTo.source}>
            <Input
              value={alertEmailTo}
              onChange={(e) => setAlertEmailTo(e.target.value)}
              placeholder="ops@example.com"
            />
          </Field>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={smtpSecure} onCheckedChange={setSmtpSecure} />
          Implicit TLS (use for port 465; leave off for 587 STARTTLS)
        </label>
      </section>

      {/* Slack */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Slack className="h-4 w-4 text-primary" />
            Slack alerts
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testing !== null || saving}
            onClick={() => runTest("slack")}
            className="gap-1.5"
          >
            {testing === "slack" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send test message
          </Button>
        </div>

        <Field
          label="Incoming webhook URL"
          source={initial.slackWebhookSet.source}
          hint={
            initial.slackWebhookSet.isSet
              ? "A webhook is stored. Leave blank to keep it."
              : "Not set — Slack alerts are disabled."
          }
        >
          <div className="flex gap-2">
            <Input
              type="password"
              value={slackWebhookUrl}
              onChange={(e) => {
                setSlackWebhookUrl(e.target.value);
                setClearSlack(false);
              }}
              autoComplete="off"
              placeholder={
                initial.slackWebhookSet.isSet
                  ? "••••••••"
                  : "https://hooks.slack.com/services/…"
              }
              disabled={clearSlack}
            />
            {initial.slackWebhookSet.isSet && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={clearSlack ? "text-down" : "text-muted-foreground"}
                onClick={() => {
                  setClearSlack((v) => !v);
                  setSlackWebhookUrl("");
                }}
                title="Clear the stored webhook"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </Field>
      </section>

      {error && (
        <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
          <Check className="h-3.5 w-3.5" />
          {message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} className="gap-1.5">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save settings
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Values saved here override the matching <code>.env</code> variables.
          Clear a field to fall back to the environment.
        </p>
      </div>
    </form>
  );
}

function Field({
  label,
  source,
  hint,
  children,
}: {
  label: string;
  source: SettingSource;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center text-xs font-medium text-foreground">
        {label}
        <SourceTag source={source} />
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
