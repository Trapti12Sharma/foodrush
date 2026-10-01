// Format checks for the Indian identity/business documents this platform collects
// (restaurant KYC, rider KYC, addresses). Pulled into one place because the same
// shape was being asked for in three different validator files, with three
// different (and inconsistent) amounts of rigour — a PAN number, for instance,
// was only checked for "non-empty, under 20 characters", which "asdkfj12345"
// satisfies just as well as a real PAN.
//
// Pure format validation only — this can tell a string LOOKS like a PAN/FSSAI/
// GST/pincode, never that the document is genuine or belongs to the submitter.
// That is what the human KYC review step (kycStatus SUBMITTED -> VERIFIED/REJECTED)
// is for; format checks exist so an obviously-fake value never reaches a reviewer.

// PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Always exactly 10 characters.
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// FSSAI licence/registration number: always a 14-digit numeric code.
const FSSAI_REGEX = /^[0-9]{14}$/;

// GST number: 2-digit state code + 10-character PAN + 1-digit entity code + 'Z' +
// 1 alphanumeric checksum. 15 characters total.
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Indian PIN codes are 6 digits and never start with 0.
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

function matchesUppercased(regex) {
  return (value) => typeof value === 'string' && regex.test(value.trim().toUpperCase());
}

const isValidPan = matchesUppercased(PAN_REGEX);
const isValidFssaiNumber = matchesUppercased(FSSAI_REGEX);
const isValidGstNumber = matchesUppercased(GST_REGEX);
const isValidPincode = matchesUppercased(PINCODE_REGEX);

// A date that is genuinely in the past, and not absurdly far in it — catches both
// an accidental future date and the "0001-01-01"-style garbage a free-text date
// picker can still be made to submit. `maxAgeYears` is deliberately generous
// (nobody here is validating that a date IS a birthdate, just that it is a
// plausible calendar date for one).
function isPastDate(value, { maxAgeYears = 120 } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = Date.now();
  const earliest = now - maxAgeYears * 365.25 * 24 * 60 * 60 * 1000;
  return date.getTime() < now && date.getTime() > earliest;
}

// The complement, for anything that must still be valid going forward — a
// licence/certificate expiry date that has already passed is not "a date", it is
// a KYC document that is no longer current.
function isFutureDate(value) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

// Driving licence numbers genuinely vary a lot across Indian states and across
// the pre-2019 vs. current format (e.g. "DL0420110149646" vs. state-specific
// variants with spaces or hyphens) — there is no single regex that accepts every
// real one without also rejecting real ones. Validated against the real risk
// here instead: being unmistakably not a licence number at all ("asdkfj", a
// repeated character, pure digits with no letters). Alphanumeric only (spaces/
// hyphens stripped before checking), 9-16 characters, and at least one letter
// and one digit — every real-world format satisfies that; "test1234" does not.
function isPlausibleLicenceNumber(value) {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  if (compact.length < 9 || compact.length > 16) return false;
  if (!/^[A-Z0-9]+$/.test(compact)) return false;
  if (!/[A-Z]/.test(compact) || !/[0-9]/.test(compact)) return false;
  if (/^(.)\1+$/.test(compact)) return false; // all one repeated character
  return true;
}

function isAtLeastYearsOld(value, years) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return date.getTime() <= cutoff.getTime();
}

module.exports = {
  PAN_REGEX,
  FSSAI_REGEX,
  GST_REGEX,
  PINCODE_REGEX,
  isValidPan,
  isValidFssaiNumber,
  isValidGstNumber,
  isValidPincode,
  isPlausibleLicenceNumber,
  isPastDate,
  isFutureDate,
  isAtLeastYearsOld,
};
