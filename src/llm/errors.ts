/** Only messages constructed by the settings/auth boundary may reach the UI. */
export class LlmSettingsError extends Error {}

export class LlmHttpError extends LlmSettingsError {
  constructor(readonly status: number) {
    const advice = status === 401 || status === 403 ? "Check the selected provider's credential or sign in again."
      : status === 429 ? "The service limit was reached. Try again later."
      : status === 400 || status === 404 ? "Check the model and service settings."
      : "Try again later.";
    super(`LLM service returned HTTP ${status}. ${advice}`);
  }
}
