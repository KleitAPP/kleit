import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Chip, EmptyState, PrimaryButton } from "@/components/kleit";
import { t } from "@/i18n/en";
import { createPoll, DURATIONS, replaceOptions, type PollOptionRow } from "@/polls/polls";
import { mySets, type SetSummary } from "@/sets/sets";
import { supabase } from "@/integrations/supabase/client";

/**
 * S52 — the poll builder (design pack §2.3; spec 7.3 #1, #7).
 *
 * Pick two to four of your published sets, give each a short label if you like, write the
 * question, choose how long it runs. The same screen edits an unlocked poll (no vote yet); a
 * locked one is reopened first, from the results screen, after the warning.
 */
export function PollBuilder({ pollId }: { pollId?: string }) {
  const navigate = useNavigate();
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [question, setQuestion] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]["id"]>("7d");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await mySets();
      if (cancelled) return;
      setSets(list);
      if (pollId) {
        const [{ data: poll }, { data: options }] = await Promise.all([
          supabase.from("polls").select("question").eq("id", pollId).maybeSingle(),
          supabase
            .from("poll_options")
            .select("id, set_id, label, sort_order")
            .eq("poll_id", pollId)
            .order("sort_order"),
        ]);
        if (cancelled) return;
        setQuestion(poll?.question ?? "");
        const rows = (options ?? []) as PollOptionRow[];
        setChosen(rows.map((o) => o.set_id));
        setLabels(Object.fromEntries(rows.map((o) => [o.set_id, o.label])));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pollId]);

  function toggle(id: string) {
    setProblem(null);
    setChosen((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : list.length >= 4 ? list : [...list, id],
    );
  }

  async function finish() {
    if (chosen.length < 2) {
      setProblem(t("pollbuilder.pickTwo"));
      return;
    }
    setBusy(true);
    setProblem(null);
    if (pollId) {
      const ok = await replaceOptions(pollId, chosen, labels);
      const { error } = ok
        ? await supabase
            .from("polls")
            .update({ question: question.trim().slice(0, 140) })
            .eq("id", pollId)
        : { error: new Error("options") };
      setBusy(false);
      if (!ok || error) {
        setProblem(t("pollbuilder.failed"));
        return;
      }
      void navigate({ to: "/poll/$pollId", params: { pollId } });
      return;
    }
    const hours = DURATIONS.find((d) => d.id === duration)?.hours ?? 168;
    const made = await createPoll({ question, setIds: chosen, labels, hours });
    setBusy(false);
    if (!made.id) {
      setProblem(t("pollbuilder.failed"));
      return;
    }
    void navigate({ to: "/poll/$pollId", params: { pollId: made.id } });
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-8">
      <h1 className="font-display text-2xl text-ink">
        {pollId ? t("pollbuilder.editTitle") : t("pollbuilder.title")}
      </h1>
      <p className="mt-2 text-sm text-ink-soft">{t("pollbuilder.what")}</p>

      <label className="mt-6 block">
        <span className="text-base text-ink">{t("pollbuilder.question")}</span>
        <input
          type="text"
          value={question}
          maxLength={140}
          placeholder={t("pollbuilder.questionHint")}
          onChange={(e) => setQuestion(e.target.value)}
          className="mt-1 w-full rounded-sm border border-line bg-surface px-3 py-3 text-base text-ink"
        />
      </label>

      <h2 className="mt-6 text-base font-medium text-ink">{t("pollbuilder.pick")}</h2>
      {sets === null ? (
        <div className="mt-3" role="status" aria-label={t("loading")}>
          <div className="kl-skeleton h-12 w-full rounded-md bg-surface-2" />
        </div>
      ) : sets.length < 2 ? (
        <EmptyState line={t("pollbuilder.needSets")} />
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {sets.map((s) => {
            const on = chosen.includes(s.id);
            const order = chosen.indexOf(s.id);
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s.id)}
                  className={`flex min-h-12 min-w-0 flex-1 items-center justify-between rounded-sm px-2 text-left text-base ${on ? "bg-surface-2 text-ink" : "text-ink"}`}
                >
                  <span className="truncate">
                    {s.title || s.layout.caption || t("profile.draftUntitled")}
                  </span>
                  <span className="ml-3 shrink-0 text-sm text-ink-soft">
                    {on ? t("pollbuilder.option", { n: order + 1 }) : ""}
                  </span>
                </button>
                {on ? (
                  <input
                    type="text"
                    value={labels[s.id] ?? ""}
                    maxLength={40}
                    placeholder={t("pollbuilder.labelHint")}
                    aria-label={t("pollbuilder.label")}
                    onChange={(e) => setLabels({ ...labels, [s.id]: e.target.value })}
                    className="w-28 rounded-sm border border-line bg-surface px-2 py-2 text-sm text-ink"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!pollId ? (
        <div className="mt-6">
          <h2 className="text-base font-medium text-ink">{t("pollbuilder.runsFor")}</h2>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label={t("pollbuilder.runsFor")}
          >
            {DURATIONS.map((d) => (
              <Chip
                key={d.id}
                label={t(`pollbuilder.d.${d.id}`)}
                selected={d.id === duration}
                onToggle={() => setDuration(d.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="mt-4 text-base text-ink">
          {problem}
        </p>
      ) : null}

      <div className="mt-6">
        <PrimaryButton onClick={() => void finish()} disabled={busy || chosen.length < 2}>
          {busy ? t("loading") : pollId ? t("pollbuilder.save") : t("pollbuilder.make")}
        </PrimaryButton>
      </div>
    </div>
  );
}
