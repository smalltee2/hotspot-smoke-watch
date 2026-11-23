# Training data of the Ask SEA-HAF topic classifier

Read by `scripts/chat_train.mjs`, together with the template questions (`scripts/chat_data.mjs`) and the questions people
labelled (`chat/learned.json`). The test questions (`chat/test.json`, `chat/test_real.json`) are never trained on: rows equal to
a test question are dropped from every source below.

- `para-*.json`: paraphrases written for each topic, in casual, polite and formal Thai, Northern Thai and Isan, Thai mixed with
  English, short keyword questions and long ones, and in English. A fixed 15 % of them (by a hash of the question) is kept out of
  training as the development set, used to choose the model.
- `massive.json`: rows of the Amazon MASSIVE 1.1 dataset (th-TH and en-US), made by `scripts/chat_massive.mjs`:
  weather_query → wx, general_greet → hi, other intents → other. Rows that mention dust, smoke, fog, fire or air quality are left out.

  MASSIVE: J. FitzGerald et al. (2022), "MASSIVE: A 1M-Example Multilingual Natural Language Understanding Dataset with 51
  Typologically-Diverse Languages", arXiv:2204.08582. Copyright Amazon.com Inc. or its affiliates. Licensed under the Creative
  Commons Attribution 4.0 International licence (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Changes: the
  wake word "olly" removed, intents mapped as above, a sample of the rows.

Every source is also varied by `scripts/chat_augment.mjs` when training: misspellings, dropped tone marks, spoken forms
(ไหม → มั้ย, อย่างไร → ยังไง), sentence-final particles, short names of places (กทม, โคราช, cnx), spaces removed or added,
repeated letters, and the Thai keyboard layout typed as English letters.
