/**
 * Consent-step button labels for the Intro. The first-run ask installs every
 * hook; a re-ask (`hooksConsentRequest.reconsent`) only concerns the prompt
 * hook behind task titles, and its answers leave the installed hooks alone, so
 * its labels name that scope instead of reading as "install / no hooks".
 * The choices sent are the same (`install` / `notNow` / `never`).
 */
export interface ConsentStepLabels {
  never: string;
  notNow: string;
  install: string;
  installPending: string;
  failedTitle: string;
}

export function consentStepLabels(reconsent: boolean): ConsentStepLabels {
  return reconsent
    ? {
        never: 'Keep Titles Off',
        notNow: 'Not Now',
        install: 'Enable Task Titles',
        installPending: 'Enabling...',
        failedTitle: "Task titles couldn't be enabled",
      }
    : {
        never: "Don't Ask Again",
        notNow: 'Not Now',
        install: 'Install Hooks',
        installPending: 'Installing...',
        failedTitle: "Hooks couldn't be installed",
      };
}
