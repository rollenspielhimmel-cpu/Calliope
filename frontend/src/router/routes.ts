import type { RouteRecordRaw } from 'vue-router'

/**
 * Separate from the router itself so a test can read them without booting the navigation
 * guard, which would pull in the session query and the whole generated client.
 */
export const routes: Array<RouteRecordRaw> = [
  // Where signing in and registering land. What it will hold is still open.
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  // The bare resource goes where the bar goes, which is the same rule for both resources below.
  // Without it the path renders nothing: there is no catch-all.
  { path: '/groups', redirect: { name: 'myGroups' } },
  // Literals before the parameter only for reading order — vue-router ranks a static segment
  // above a parameter regardless of where it is declared.
  {
    path: '/groups/mine',
    name: 'myGroups',
    component: () => import('../views/GroupsView.vue'),
  },
  {
    path: '/groups/discover',
    name: 'discoverGroups',
    component: () => import('../views/DiscoverView.vue'),
  },
  {
    path: '/groups/:groupId',
    name: 'group',
    component: () => import('../views/GroupView.vue'),
  },
  {
    path: '/groups/:groupId/threads/:threadId',
    name: 'thread',
    component: () => import('../views/ThreadView.vue'),
  },
  {
    path: '/groups/:groupId/pages/:pageId',
    name: 'page',
    component: () => import('../views/PageView.vue'),
  },
  // The forum's pages share one rail, so they hang off `ForumLayout` for the reason the group's
  // do. The parent stays unnamed; `forum` is the empty child.
  {
    path: '/forum',
    component: () => import('../components/layout/ForumLayout.vue'),
    children: [
      {
        path: '',
        name: 'forum',
        component: () => import('../views/ForumView.vue'),
        // This page is the forum's tree, so the rail would show it twice.
        meta: { listsForumContents: true },
      },
      {
        path: 'threads/:threadId',
        name: 'forumThread',
        component: () => import('../views/ForumThreadView.vue'),
      },
      {
        path: 'pages/:pageId',
        name: 'forumPage',
        component: () => import('../views/ForumPageView.vue'),
      },
    ],
  },
  // Readable signed out: a legal notice has to be reachable from the sign-in page too. English
  // path like every other route, even though the page is titled „Impressum" — the rule holds and
  // nothing legal turns on the URL.
  {
    path: '/imprint',
    name: 'imprint',
    component: () => import('../views/ImprintView.vue'),
    meta: { access: 'anyone' },
  },
  {
    path: '/privacy-policy',
    name: 'privacyPolicy',
    component: () => import('../views/PrivacyPolicyView.vue'),
    meta: { access: 'anyone' },
  },
  // As above: the bare path follows the bar, which for ideas is the carousel rather than a list.
  { path: '/story-ideas', redirect: { name: 'storyIdeasCarousel' } },
  {
    path: '/story-ideas/mine',
    name: 'myStoryIdeas',
    component: () => import('../views/StoryIdeasView.vue'),
    props: { mine: true },
  },
  {
    path: '/story-ideas/discover',
    name: 'discoverStoryIdeas',
    component: () => import('../views/StoryIdeasView.vue'),
  },
  // The id is optional: opening the carousel without one starts at the newest unread idea.
  {
    path: '/story-ideas/carousel/:ideaId?',
    name: 'storyIdeasCarousel',
    component: () => import('../views/StoryIdeaCarouselView.vue'),
  },
  {
    path: '/story-ideas/:ideaId',
    name: 'storyIdea',
    component: () => import('../views/StoryIdeaView.vue'),
  },
  // `anyone`: a page may be public, and which ones are is the data's own business — the API
  // answers 404 for a private one read without a session, so the guard must not refuse first.
  {
    path: '/pages/:slug',
    // `customPage` rather than `page`: upstream now has a page *inside a group*, and that one is
    // the `page` route. These are two different things that happened to want the same word.
    name: 'customPage',
    component: () => import('../views/CustomPageView.vue'),
    meta: { access: 'anyone' },
  },
  // Members only: applying needs an account, and the running Blind-Dates are shown to the
  // community rather than to the internet.
  {
    path: '/blind-date',
    name: 'blindDate',
    component: () => import('../views/BlindDateView.vue'),
  },
  // Where a card's „Weiterlesen" goes. Members only, like the page it comes from: the offers are
  // what somebody applies to, and applying needs an account.
  {
    path: '/blind-date/handlungen/:offerId',
    name: 'blindDateOffer',
    component: () => import('../views/BlindDateOfferView.vue'),
  },
  {
    path: '/members',
    name: 'members',
    component: () => import('../views/MembersView.vue'),
  },
  {
    path: '/members/:userId',
    name: 'member',
    component: () => import('../views/MemberView.vue'),
  },
  {
    // The one way in to everything the team does. The report queue is a page *inside* it rather
    // than an area of its own, which is why it moved down to /moderation/reports.
    path: '/moderation',
    name: 'moderation',
    component: () => import('../views/ModerationView.vue'),
    meta: { access: 'operator' },
  },
  {
    path: '/moderation/reports',
    name: 'moderationReports',
    component: () => import('../views/ReportsView.vue'),
    meta: { access: 'operator' },
  },
  // The pages of that one area. Flat rather than nested children, because each stands on its
  // own and none of them shares a frame with the overview.
  {
    path: '/moderation/ip-addresses',
    name: 'moderationIpAddresses',
    component: () => import('../views/moderation/IpAddressesView.vue'),
    meta: { access: 'operator' },
  },
  {
    path: '/moderation/blind-date',
    name: 'moderationBlindDate',
    component: () => import('../views/moderation/BlindDateView.vue'),
    meta: { access: 'operator' },
  },
  {
    path: '/moderation/strikes',
    name: 'moderationStrikes',
    component: () => import('../views/moderation/StrikesView.vue'),
    meta: { access: 'operator' },
  },
  {
    path: '/moderation/roles',
    name: 'moderationRoles',
    component: () => import('../views/moderation/RolesView.vue'),
    meta: { access: 'operator' },
  },
  {
    path: '/moderation/invitations',
    name: 'moderationInvitations',
    component: () => import('../views/moderation/InvitationsView.vue'),
    meta: { access: 'operator' },
  },
  // What changes the platform itself, rather than one account: administrator only.
  {
    path: '/moderation/content-filters',
    name: 'moderationContentFilters',
    component: () => import('../views/moderation/ContentFiltersView.vue'),
    meta: { access: 'administrator' },
  },
  {
    path: '/moderation/broadcast',
    name: 'moderationBroadcast',
    component: () => import('../views/moderation/BroadcastView.vue'),
    meta: { access: 'administrator' },
  },
  {
    path: '/moderation/pages',
    name: 'moderationPages',
    component: () => import('../views/moderation/PagesView.vue'),
    meta: { access: 'administrator' },
  },
  {
    path: '/moderation/profile-fields',
    name: 'moderationProfileFields',
    component: () => import('../views/moderation/ProfileFieldsView.vue'),
    meta: { access: 'administrator' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { access: 'guest' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('../views/RegisterView.vue'),
    meta: { access: 'guest' },
  },
  {
    path: '/forgot-password',
    name: 'forgotPassword',
    component: () => import('../views/ForgotPasswordView.vue'),
    meta: { access: 'guest' },
  },
  {
    path: '/reset-password',
    name: 'resetPassword',
    component: () => import('../views/ResetPasswordView.vue'),
    meta: { access: 'anyone' },
  },
  // Same reasoning as the reset link: a verification link is often opened in a different
  // browser from the one that registered.
  {
    path: '/verify-email-address',
    name: 'verifyEmailAddress',
    component: () => import('../views/VerifyEmailAddressView.vue'),
    meta: { access: 'anyone' },
  },
  // Both reached from a mailed link, so neither may depend on a session: confirming is done
  // from the new address's mailbox, and cancelling by whoever still reads the old one — who,
  // in the case worth defending against, is not the person holding the session.
  {
    path: '/confirm-email-address-change',
    name: 'confirmEmailAddressChange',
    component: () => import('../views/ConfirmEmailAddressChangeView.vue'),
    meta: { access: 'anyone' },
  },
  {
    path: '/cancel-email-address-change',
    name: 'cancelEmailAddressChange',
    component: () => import('../views/CancelEmailAddressChangeView.vue'),
    meta: { access: 'anyone' },
  },
  // Also from a mailed link, and reached with the session already gone in the common case:
  // somebody deleting their account often does it from a phone they are not signed in on.
  {
    path: '/confirm-account-deletion',
    name: 'confirmAccountDeletion',
    component: () => import('../views/ConfirmAccountDeletionView.vue'),
    meta: { access: 'anyone' },
  },
  // Where a signed-in member with an unconfirmed address is held. An ordinary member route
  // — it needs a session — and the guard below keeps everyone else off it.
  {
    path: '/verify-email-address-required',
    name: 'verifyEmailAddressRequired',
    component: () => import('../views/VerifyEmailAddressRequiredView.vue'),
  },
]
