import { useI18n } from "../i18n/useI18n";

type FirstRunGuideProps = {
  title: string;
  onTitleChange: (value: string) => void;
  draftAvailable: boolean;
  projectCreated: boolean;
  onCreateProject: () => void;
  onRestoreDraft: () => void;
  onCreateFirstPage: () => void;
};

export const FirstRunGuide = ({
  title,
  onTitleChange,
  draftAvailable,
  projectCreated,
  onCreateProject,
  onRestoreDraft,
  onCreateFirstPage,
}: FirstRunGuideProps) => {
  const { t } = useI18n();

  return (
    <section className="first-run-card">
      <p className="eyebrow">{t("firstRun.startHere")}</p>
      <h1>{t("firstRun.headline")}</h1>
      <p className="lede">{t("firstRun.lede")}</p>
      {!projectCreated ? (
        <div className="first-run-form">
          <label>
            <span>{t("firstRun.projectTitle")}</span>
            <input
              aria-label={t("firstRun.projectTitle")}
              placeholder={t("firstRun.projectTitlePlaceholder")}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          </label>
          <div className="cta-row">
            <button className="primary-button" onClick={onCreateProject}>
              {t("firstRun.createProject")}
            </button>
            {draftAvailable ? (
              <button onClick={onRestoreDraft}>{t("firstRun.restoreDraft")}</button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="first-run-form">
          <p className="hint">{t("firstRun.projectCreatedHint")}</p>
          <div className="cta-row">
            <button className="primary-button" onClick={onCreateFirstPage}>
              {t("firstRun.createFirstPage")}
            </button>
          </div>
        </div>
      )}
      <ol className="checklist">
        <li>{t("firstRun.checklist.createProject")}</li>
        <li>{t("firstRun.checklist.createPage")}</li>
        <li>{t("firstRun.checklist.addPanel")}</li>
        <li>{t("firstRun.checklist.importImage")}</li>
        <li>{t("firstRun.checklist.addDialogue")}</li>
        <li>{t("firstRun.checklist.exportPage")}</li>
      </ol>
    </section>
  );
};

const stepKeyMap = {
  addPage: {
    title: "onboarding.addPage.title",
    body: "onboarding.addPage.body",
    action: "onboarding.addPage.action",
  },
  addPanel: {
    title: "onboarding.addPanel.title",
    body: "onboarding.addPanel.body",
    action: "onboarding.addPanel.action",
  },
  importImage: {
    title: "onboarding.importImage.title",
    body: "onboarding.importImage.body",
    action: "onboarding.importImage.action",
  },
  addDialogue: {
    title: "onboarding.addDialogue.title",
    body: "onboarding.addDialogue.body",
    action: "onboarding.addDialogue.action",
  },
  exportPage: {
    title: "onboarding.exportPage.title",
    body: "onboarding.exportPage.body",
    action: "onboarding.exportPage.action",
  },
} as const;

type OnboardingStep = keyof typeof stepKeyMap;

export const OnboardingBanner = ({
  step,
  onAction,
}: {
  step: OnboardingStep;
  onAction: () => void;
}) => {
  const { t } = useI18n();

  return (
    <section className="onboarding-banner">
      <div>
        <p className="eyebrow">{t("onboarding.title")}</p>
        <h2>{t(stepKeyMap[step].title)}</h2>
        <p>{t(stepKeyMap[step].body)}</p>
      </div>
      <button className="primary-button" onClick={onAction}>
        {t(stepKeyMap[step].action)}
      </button>
    </section>
  );
};
