import { useEffect, useState } from "react";

import { Sheet } from "@/components/kleit";
import { t } from "@/i18n/en";
import {
  addComment,
  comments as loadComments,
  EDIT_WINDOW_MS,
  editComment,
  react,
  REACTIONS,
  removeComment,
  social as loadSocial,
  toggleLike,
  type Comment,
  type Reaction,
  type Social,
} from "@/social/comments";

/**
 * S73/S74 on the set page (M5.4): Like with its count, six reactions, and the comments sheet -
 * post, edit your own for 15 minutes, take back, and (the set's owner) remove. The database
 * decides who may do what; a refused write just leaves the screen as it was.
 */
export function SocialBar({
  setId,
  me,
  mine,
  commentsSetting,
}: {
  setId: string;
  me: string | null;
  mine: boolean;
  commentsSetting: "everyone" | "following" | "off";
}) {
  const [social, setSocial] = useState<Social | null>(null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadSocial(setId).then((s) => !cancelled && setSocial(s));
    return () => {
      cancelled = true;
    };
  }, [setId]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadComments(setId).then((c) => !cancelled && setList(c));
    return () => {
      cancelled = true;
    };
  }, [open, setId]);

  if (!social || !me) return null;

  async function like() {
    if (!social) return;
    const on = !social.myLike;
    setSocial({ ...social, myLike: on, likes: social.likes + (on ? 1 : -1) });
    if (!(await toggleLike(setId, on))) setSocial(social);
  }
  async function pick(emoji: Reaction) {
    if (!social) return;
    const next = social.myReaction === emoji ? null : emoji;
    const reactions = { ...social.reactions };
    if (social.myReaction)
      reactions[social.myReaction] = Math.max(0, (reactions[social.myReaction] ?? 1) - 1);
    if (next) reactions[next] = (reactions[next] ?? 0) + 1;
    setSocial({ ...social, myReaction: next, reactions });
    if (!(await react(setId, next))) setSocial(social);
  }
  async function post() {
    if (!draft.trim()) return;
    setRefused(false);
    const c = await addComment(setId, draft);
    if (!c) {
      setRefused(true);
      return;
    }
    setDraft("");
    setList((l) => [...(l ?? []), c]);
    setSocial((s) => (s ? { ...s, comments: s.comments + 1 } : s));
  }
  async function saveEdit() {
    if (!editing || !editing.body.trim()) return;
    const ok = await editComment(editing.id, editing.body);
    if (ok)
      setList((l) =>
        (l ?? []).map((c) =>
          c.id === editing.id
            ? { ...c, body: editing.body.trim(), edited_at: new Date().toISOString() }
            : c,
        ),
      );
    setEditing(null);
  }
  async function remove(c: Comment) {
    const ok = await removeComment(c.id);
    if (ok) {
      setList((l) =>
        (l ?? []).map((x) =>
          x.id === c.id ? { ...x, deleted_at: new Date().toISOString(), deleted_by: me } : x,
        ),
      );
      setSocial((s) => (s ? { ...s, comments: Math.max(0, s.comments - 1) } : s));
    }
  }

  const off = commentsSetting === "off" && !mine;

  return (
    <section className="mt-6" aria-label={t("social.comments")}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void like()}
          aria-pressed={social.myLike}
          className={`min-h-11 rounded-pill px-4 text-sm font-medium ${social.myLike ? "bg-brand text-brand-ink" : "border border-line bg-surface text-ink"}`}
        >
          {social.myLike ? t("social.liked") : t("social.like")} · {social.likes}
        </button>
        <div className="flex gap-1" role="group" aria-label={t("social.react")}>
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => void pick(e)}
              aria-pressed={social.myReaction === e}
              aria-label={`${e} ${social.reactions[e] ?? 0}`}
              className={`min-h-11 min-w-11 rounded-pill px-2 text-base ${social.myReaction === e ? "border-2 border-ink bg-surface-2" : "border border-line bg-surface"}`}
            >
              {e}
              {social.reactions[e] ? (
                <span className="ml-1 text-xs text-ink-soft">{social.reactions[e]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-11 rounded-pill border border-line bg-surface px-4 text-sm font-medium text-ink"
        >
          {t("social.commentsN", { count: social.comments })}
        </button>
      </div>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("social.comments")}
        {...(off ? { description: t("social.off") } : {})}
      >
        {!list ? (
          <div className="kl-skeleton h-24 w-full rounded-md bg-surface-2" />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.length === 0 ? (
              <li className="text-sm text-ink-soft">{t("social.none")}</li>
            ) : null}
            {list.map((c) => {
              const name = c.author?.display_name?.trim() || c.author?.username || "…";
              const canEdit =
                c.author_id === me &&
                !c.deleted_at &&
                Date.now() - new Date(c.created_at).getTime() < EDIT_WINDOW_MS;
              return (
                <li key={c.id} className="rounded-md border border-line bg-surface p-3">
                  <p className="text-sm text-ink-soft">
                    @{c.author?.username ?? "…"}
                    {c.edited_at && !c.deleted_at ? ` · ${t("social.edited")}` : ""}
                  </p>
                  {c.deleted_at ? (
                    <p className="text-base text-ink-soft">
                      <em>
                        {c.deleted_by === c.author_id
                          ? t("social.removedByAuthor")
                          : t("social.removedByOwner")}
                      </em>
                    </p>
                  ) : editing?.id === c.id ? (
                    <div className="mt-1 flex gap-2">
                      <input
                        type="text"
                        value={editing.body}
                        maxLength={500}
                        onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                        aria-label={t("social.edit")}
                        className="min-h-11 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink"
                      />
                      <button
                        type="button"
                        onClick={() => void saveEdit()}
                        className="min-h-11 rounded-pill bg-brand px-4 text-sm text-brand-ink"
                      >
                        {t("social.save")}
                      </button>
                    </div>
                  ) : (
                    <p
                      className="whitespace-pre-wrap break-words text-base text-ink"
                      aria-label={name}
                    >
                      {c.body}
                    </p>
                  )}
                  {!c.deleted_at ? (
                    <div className="mt-2 flex gap-3 text-sm">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: c.id, body: c.body })}
                          className="underline underline-offset-2 text-ink"
                        >
                          {t("social.edit")}
                        </button>
                      ) : null}
                      {c.author_id === me ? (
                        <button
                          type="button"
                          onClick={() => void remove(c)}
                          className="underline underline-offset-2 text-ink"
                        >
                          {t("social.takeBack")}
                        </button>
                      ) : mine ? (
                        <button
                          type="button"
                          onClick={() => void remove(c)}
                          className="underline underline-offset-2 text-ink"
                        >
                          {t("social.remove")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {!off ? (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post();
            }}
          >
            <input
              type="text"
              value={draft}
              maxLength={500}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("social.write")}
              aria-label={t("social.write")}
              className="min-h-12 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="min-h-12 rounded-pill bg-brand px-5 text-base font-medium text-brand-ink disabled:opacity-40"
            >
              {t("social.post")}
            </button>
          </form>
        ) : null}
        {refused ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {t("social.cantComment")}
          </p>
        ) : null}
      </Sheet>
    </section>
  );
}
