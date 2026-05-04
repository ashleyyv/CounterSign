module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Default subject-case rejects common acronyms (AI, API, PDF) and title-style phrases.
    'subject-case': [0],
  },
};
