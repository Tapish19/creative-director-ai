"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Check, Clock3, Film, LoaderCircle, Sparkles } from "lucide-react";
import { saveCampaign } from "@/app/campaigns/actions";
import { sampleCampaign } from "@/lib/sample-campaign";
import type { ActionState, CampaignBrief, Project } from "@/types/campaign";

const blank: CampaignBrief = {
  name: "",
  product_name: "",
  description: "",
  target_audience: "",
  tone: "",
  duration: 15,
  website_url: null,
  goal: "",
};

export function CampaignForm({
  project,
  useSample = false,
  canSave,
}: {
  project?: Project;
  useSample?: boolean;
  canSave: boolean;
}) {
  const [values, setValues] = useState<CampaignBrief>(
    project ?? (useSample ? sampleCampaign : blank),
  );
  const [state, action, pending] = useActionState(
    saveCampaign.bind(null, project?.id ?? null),
    {} as ActionState,
  );
  const field = (name: keyof CampaignBrief) => ({
    id: name,
    name,
    value: values[name] ?? "",
    required: name !== "website_url",
    "aria-invalid": !!state.fieldErrors?.[name],
    "aria-describedby": state.fieldErrors?.[name] ? `${name}-error` : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  });
  const error = (name: keyof CampaignBrief) =>
    state.fieldErrors?.[name] && (
      <p className="field-error" id={`${name}-error`}>
        {state.fieldErrors[name]?.[0]}
      </p>
    );

  return (
    <form action={action} className="brief-layout">
      <div className="brief-main">
        <section className="panel brief-panel">
          <div className="panel-heading">
            <div>
              <span className="section-number">01</span>
              <h2>Tell us the story</h2>
            </div>
            <button
              type="button"
              className="sample-button"
              onClick={() => setValues({ ...sampleCampaign })}
            >
              <Sparkles size={14} />
              Use sample brief
            </button>
          </div>
          <p className="panel-intro">A few good details make all the difference.</p>
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="name">Campaign name</label>
              <input
                {...field("name")}
                placeholder="Give this creative direction a name"
                minLength={2}
                maxLength={120}
              />
              {error("name")}
            </div>
            <div className="field full">
              <label htmlFor="product_name">Product or company name</label>
              <input
                {...field("product_name")}
                placeholder="e.g. MyHotelLine"
                minLength={2}
                maxLength={120}
              />
              {error("product_name")}
            </div>
            <div className="field full">
              <label htmlFor="description">What does your product do?</label>
              <textarea
                {...field("description")}
                rows={5}
                minLength={20}
                maxLength={4000}
                placeholder="Describe the product, what makes it useful, and what you want this ad to show."
              />
              {error("description")}
              <span className="field-hint">
                Be specific about benefits. Avoid claims you can’t back up.
              </span>
            </div>
            <div className="field">
              <label htmlFor="target_audience">Who is it for?</label>
              <input
                {...field("target_audience")}
                placeholder="e.g. Independent hotel owners"
                minLength={2}
                maxLength={500}
              />
              {error("target_audience")}
            </div>
            <div className="field">
              <label htmlFor="tone">How should it feel?</label>
              <input
                {...field("tone")}
                placeholder="e.g. Confident and approachable"
                minLength={2}
                maxLength={120}
              />
              {error("tone")}
            </div>
            <div className="field full">
              <label htmlFor="goal">What should viewers do next?</label>
              <input
                {...field("goal")}
                placeholder="e.g. Book a free product demo"
                minLength={2}
                maxLength={500}
              />
              {error("goal")}
            </div>
            <div className="field full">
              <label htmlFor="website_url">
                Website <span className="optional">Optional</span>
              </label>
              <input
                {...field("website_url")}
                type="url"
                placeholder="https://yourcompany.com"
                maxLength={2048}
              />
              {error("website_url")}
              <span className="field-hint">
                Saved as reference. This phase does not fetch or analyze the website.
              </span>
            </div>
          </div>
        </section>
        <section className="panel format-panel">
          <div className="panel-heading">
            <div>
              <span className="section-number">02</span>
              <h2>Set the pace</h2>
            </div>
            <span className="muted small">Short form. Lasting impression.</span>
          </div>
          <fieldset className="duration-options">
            <legend className="sr-only">Video duration</legend>
            {([15, 30] as const).map((duration) => (
              <label
                className={`duration-option ${values.duration === duration ? "selected" : ""}`}
                key={duration}
              >
                <input
                  type="radio"
                  name="duration"
                  value={duration}
                  checked={values.duration === duration}
                  onChange={() => setValues((current) => ({ ...current, duration }))}
                />
                <Clock3 size={20} />
                <span>
                  <strong>{duration} seconds</strong>
                  <small>
                    {duration === 15 ? "A sharp, focused story" : "A little more room to tell it"}
                  </small>
                </span>
                <span className="radio-indicator">
                  {values.duration === duration && <Check size={12} />}
                </span>
              </label>
            ))}
          </fieldset>
          {error("duration")}
        </section>
        <div className="form-actions">
          {state.message && (
            <p className="error-notice" role="alert">
              {state.message}
            </p>
          )}
          <p>Your brief stays editable until generation begins.</p>
          <button type="submit" className="button primary" disabled={pending || !canSave}>
            {pending ? <LoaderCircle className="spin" size={17} /> : null}
            {pending ? "Saving campaign…" : project ? "Save changes" : "Create campaign"}
            {!pending && <ArrowRight size={17} />}
          </button>
          {!canSave && <span className="save-hint">Connect Supabase to save this brief.</span>}
        </div>
      </div>
      <aside className="brief-aside">
        <div className="format-preview">
          <span className="preview-kicker">
            <Film size={14} />
            THE CREATIVE CANVAS
          </span>
          <div className="portrait-preview">
            <span className="portrait-top">YOUR STORY STARTS HERE</span>
            <span className="portrait-spark">✳</span>
            <h3>{values.product_name || "Your next\nbig idea."}</h3>
            <span className="portrait-bottom">
              {values.duration} SECONDS <span>9:16</span>
            </span>
          </div>
          <div className="preview-caption">
            <span />
            Vertical social video
          </div>
          <p>Format illustration · Video has not been generated.</p>
        </div>
        <div className="brief-tip">
          <Sparkles size={18} />
          <h3>Give it a clear direction.</h3>
          <p>The best briefs focus on one audience, one real benefit, and one next step.</p>
        </div>
        <div className="approval-note">
          <span className="check-circle">
            <Check size={14} />
          </span>
          <p>
            <strong>You make the final call.</strong>
            <br />
            Creatives will need your approval before they’re marked final.
          </p>
        </div>
      </aside>
    </form>
  );
}
