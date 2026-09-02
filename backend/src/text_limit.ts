/**
 * Upper bounds for everything a member can type. Without them a single request can store
 * megabytes: the API accepted and stored a 20 MB post before these existed.
 *
 * The database columns are all `text` and enforce nothing, so these are the only limit.
 * Kept together rather than at each route so the numbers can be compared and changed as a
 * set — the API and the interface have to agree on them.
 */
export const TEXT_LIMIT = {
  /** Fits a rail row and an avatar's title without wrapping. */
  username: 32,
  /** The longest address SMTP has to accept, RFC 5321 §4.5.3.1.3. */
  emailAddress: 254,
  /**
   * scrypt reads the whole input, so unlike bcrypt — which stopped at 72 bytes and silently
   * ignored the rest — a long passphrase is worth what it looks like. The bound is here only
   * to keep the hashing input finite.
   */
  password: 256,
  /** A group title sits on one line beside its privacy badge. */
  groupTitle: 120,
  /** Long enough for any name or title being looked for, short enough to bound the scan. */
  search: 120,
  /** A chat's name sits on one line in a narrow list beside the unread count. */
  chatTitle: 80,
  /** A step is one line in the rail — a reminder, not a plan. */
  stepText: 200,
  /** A message is a remark, not a chapter. Long enough for a paragraph, far short of a post. */
  messageText: 4_000,
  /** A second line under the title, as a book has one. */
  groupSubtitle: 120,
  /** The story at length, not the story itself: a treatment, far short of a chapter. */
  groupSynopsis: 8_000,
  /**
   * Themes and setting, written rather than chosen: both were put to beta testers as lists and
   * came back with nothing added, so they describe instead of filtering. A line or two.
   */
  storyMetadataText: 500,
  threadTitle: 120,
  /** A page's name in the tree, on one line, like a thread's. */
  pageTitle: 120,
  folderTitle: 120,
  /** One line under the folder's title, saying what belongs in it. */
  folderDescription: 500,
  /** Same bounds as the group it may become; an idea is a pitch, not the story. */
  storyIdeaTitle: 120,
  storyIdeaSubtitle: 120,
  /** What a board shows: a few sentences that have to stand on their own. */
  storyIdeaTeaser: 2_000,
  /** The long version, on the idea's own page. Same bound as the group's, which it becomes. */
  storyIdeaSynopsis: 8_000,
  /** One free-text line each: what is sought, how one writes, when one can. */
  storyIdeaDetail: 500,
  /**
   * Every document — a post or a page — bounded by its prose, not its serialisation. Roughly a
   * long chapter: long-form writing, so deliberately generous.
   */
  documentText: 100_000,
  /** An operator's note about why an account was banned. Same room as a report's reason. */
  banReason: 2_000,
  /**
   * One word the community does not print. Long enough for a compound, short enough that nobody
   * pastes a sentence in: the list matches substrings, and a sentence would match nothing.
   */
  blockedWord: 60,
  /** Why a word is on the list, for the entries where „it is a slur" is not the whole story. */
  blockedWordNote: 300,
  /** A Blind-Date plot: the name of an official RSH story, not a description of one. */
  blindDatePlotTitle: 120,
  /** The plot the team offers, and what it is about. */
  blindDateOfferTitle: 120,
  /**
   * Room for a real plot rather than a paragraph. It began at 2,000, which a first offer reached
   * and was silently cut at — the form's own `maxlength` stopped the typing, so nothing said so
   * and the text simply ended mid-sentence.
   *
   * 8,000 is what a group's synopsis and a story idea's take, and this is the same kind of writing.
   */
  blindDateOfferDescription: 8_000,
  /**
   * One role in an offered plot, as it appears in the applicant's list of choices. A name and at
   * most a few words after it — „Die Wirtin", „Der Fremde (Ende offen)" — not a character sheet.
   */
  blindDateOfferRole: 80,
  /**
   * How many roles one offer may name. High enough that no realistic plot hits it, low enough that
   * the list stays a list somebody can read through before choosing.
   */
  blindDateOfferRoles: 20,
  /** One genre chip, and how many an offer may carry. Chips are scanned, not read. */
  blindDateOfferGenre: 40,
  blindDateOfferGenres: 8,
  /**
   * The two preferences that are prose rather than a choice — which gender the role is, and what
   * pairing somebody is after. Room for a sentence, because real answers are one.
   */
  blindDatePreference: 300,
  /** Anything else the applicant wants the team to know before it matches them. */
  blindDateApplicationNote: 1_000,
  /**
   * The free half of the Blind-Date feedback form. Room for a paragraph rather than an essay: the
   * two questions above it are the ones that can be counted, and this is the one that takes effort.
   */
  blindDateFeedbackNote: 2_000,
  /** Why somebody is excluded from Blind-Date. Required, unlike a watchlist note. */
  blindDateExclusionReason: 1_000,
  /** Why a member is reporting something. Room to explain, not to write an essay. */
  reportReason: 2_000,
  /** What an operator decided about a report, beside the outcome. Same room as the reason it answers. */
  reportClosingNote: 2_000,
  /** One answer each on a profile: how somebody writes, how often, what they will not write. */
  profileDetail: 500,
  /** The one profile field that invites prose rather than an answer. */
  profileAboutMe: 2_000,
  /**
   * Where a picture came from. Generous on purpose: a licence clause pasted whole, or a long URL,
   * is exactly what somebody doing this properly will have, and truncating an attribution is the
   * one thing this field must not do.
   */
  avatarCredit: 4_000,
  /** A status update is a remark, not a chapter — same room as a chat message. */
  statusUpdateBody: 4_000,
  /** A reply to a status update. Short by design; it's a comment, not a second status. */
  statusUpdateCommentBody: 1_000,
  /** A mail subject line, which clients truncate long before this. */
  broadcastSubject: 200,
  /** One message to everybody. Room for an announcement, far short of a newsletter. */
  broadcastBody: 10_000,
  /** A page's address, which is also its identity. */
  pageSlug: 80,
  pageTitle: 120,
  /** The rules or an FAQ written out. Generous: these are the longest prose here after a post. */
  pageBody: 50_000,
  /** What a profile question asks. One line, the way the fixed fields ask theirs. */
  profileQuestionPrompt: 200,
  /** One answer somebody may pick. A label, not a sentence. */
  profileQuestionOption: 120,
  /** Which part of the profile a question belongs under. */
  profileQuestionSection: 80,
  /** A forum category is a heading over a handful of sub-forums. */
  forumCategoryTitle: 80,
  subForumTitle: 80,
  /** The line or two under a sub-forum's title saying what belongs in it. */
  subForumDescription: 300,
} as const;

/**
 * Ceiling on any request body, as a second line of defence: the limits above only apply
 * once a body has been read and parsed, and this stops an oversized one being buffered at
 * all. Comfortably above the largest legitimate request, which is a full-length post.
 */
export const REQUEST_BODY_LIMIT_BYTES = 1_048_576;

/**
 * A photograph straight off a phone, before it is re-encoded to something small. Applied by path in
 * `app.ts`: a limit declared on the route itself never runs, because the global one refuses first.
 */
export const UPLOAD_BODY_LIMIT_BYTES = 4 * 1_048_576;

/**
 * How many entries a list of labels may hold. Bounded for the same reason the text is: a
 * request should not be able to store an unbounded array, and a rail full of tags stops
 * being readable long before it stops being valid.
 */
export const LIST_LIMIT = {
  /** How many a story may claim. Twelve genres is already more than a story has. */
  storyTags: 12,
  /**
   * How many a *filter* may ask for, which is a different question and was the same number for
   * one release. A board offers sixteen genres and thirty-one tropes, so a member picking
   * thirteen got a 400 — and the view drops its filters when the list fails to load, leaving
   * nothing to click to undo it. A hundred is past the longest vocabulary (seventy-six
   * subgenres): asking for more of a list than it holds is meaningless rather than harmful.
   */
  storyVocabularyFilter: 100,
  /** How many answers one profile question may offer. A list longer than this is a text field. */
  profileQuestionOptions: 30,
} as const;

/**
 * Lower bounds, where a value that is merely non-empty would be useless.
 */
export const TEXT_MINIMUM = {
  /**
   * Matched to the search minimum below: a shorter username could be registered and then
   * never turn up in a search, which would make its owner impossible to invite.
   */
  username: 3,
  /**
   * A search term shorter than this is close enough to no filter at all, and would let the
   * user list be walked page by page — the thing a directory of a private platform must not
   * allow.
   */
  search: 3,
  /**
   * The floor NIST and OWASP both name. **Only where a password is chosen** — registering,
   * resetting, changing — never where one is proved, or a shorter existing one could not sign in.
   */
  password: 8,
} as const;
