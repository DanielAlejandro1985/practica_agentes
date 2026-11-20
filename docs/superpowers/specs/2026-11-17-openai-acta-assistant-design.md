# OpenAI Acta Assistant

## Intent and why

Add an optional AI-assisted workflow that analyzes the uploaded PowerPoint text,
the Excel attachments, and the acta fields already entered, then completes and
redrafts the acta for review.

## Goals

- Keep the API-key section hidden until the user chooses AI analysis.
- Use one "Análisis con IA" action to reveal setup when no key is configured and
  run the analysis after the key has been saved.
- Store the key only in server memory for the lifetime of the Flask process.
- Ask for confirmation before sending data to OpenAI.
- Send presentation text and Excel attachment contents to OpenAI for analysis.
- Return generated values for all editable acta fields.
- Keep the existing manual and local-OCR workflows available.

## Non-goals

- Persist the API key in SQLite or browser storage.
- Add a new provider or support provider-specific credentials.
- Automatically save or export generated content; generated values require user review.
- Perform financial calculations beyond information present in the inputs.

## Constraints

- The provider is OpenAI.
- The key is entered by the user in the app and cleared when the Flask process stops.
- The key is sent to the local Flask backend for in-memory storage and is not
  returned by the backend or persisted in browser storage.
- The app remains local; no API key is committed to source or environment files.
- Generated output must include only supported acta fields and must not invent source data.

## Approaches

1. Call OpenAI directly from the browser:
   - Simple implementation.
   - Rejected because the browser cannot keep an API key private.
2. Persist the OpenAI key in SQLite:
   - Convenient across restarts.
   - Rejected because it would require extra master-secret handling for encrypted storage.
3. Keep the key in Flask memory and expose one server endpoint:
   - The key never enters browser storage or source code.
   - It must be entered again after restarting the app.
   - Selected for the security tradeoff.

## Agreed behavior

- The default UI shows an "Análisis con IA" button and hides the API-key field.
- If no key is configured, clicking "Análisis con IA" reveals a masked key field
  and a save action; it does not start a generation request.
- After the key is saved, clicking the same "Análisis con IA" button asks for
  confirmation and starts the analysis.
- A secondary "Cambiar API key" control can reopen the key-entry field.
- The key status is shown only in the AI section, not as a global app status.
- When AI is enabled, the backend receives:
  - The current editable acta fields.
  - Extracted presentation text.
  - Extracted text from uploaded Excel attachments.
- OpenAI returns a strict JSON object containing:
  `clientName`, `clientType`, `analysisType`, `line`, `proposal`, `amount`,
  `risk`, `group`, `profile`, `financial`, `guarantees`, `conditions`,
  `recommendation`, and `observations`.
- Before replacing the form, the user sees a success/error state and can review
  or manually edit every generated field.
- Missing or invalid API credentials produce an explicit error and leave the form unchanged.
- Existing PowerPoint OCR extraction remains local and existing Excel uploads remain unchanged.
