import { z } from 'zod';
import {
  membershipRoleSchema,
  membershipStatusSchema,
  uuidSchema,
  visibilitySchema,
} from '../common/primitives.js';
import { profileSummarySchema } from '../users/users.contract.js';

/**
 * Communities and study groups.
 *
 * The shapes encode the phase's central distinction: a container's `viewer`
 * block reports what the reader may *do*, computed server-side, so the client
 * never has to work out whether a "Join" button should say "Join" or "Ask to
 * join" — a button that silently does something other than its label is a small
 * lie the client should not be in a position to tell.
 */

export const joinPolicySchema = z.enum(['open', 'request', 'invite']);
export type JoinPolicy = z.infer<typeof joinPolicySchema>;

/**
 * What the reader may do with this container.
 *
 * Every gate is reported separately, exactly as the policy computes them. They
 * are deliberately not collapsed into one `hasAccess`: "may see it exists",
 * "may read inside it", "may write in it" and "may administer it" are four
 * different questions, and a client given one boolean will draw a screen that
 * answers the wrong one.
 *
 * The client's rule is that it renders these and never re-derives them. A
 * control whose gate is false is not rendered — not rendered and disabled, and
 * never rendered and inert.
 */
export const containerViewerStateSchema = z.object({
  membershipStatus: membershipStatusSchema.nullable(),
  role: membershipRoleSchema.nullable(),
  /** 'joined' applies immediately; 'requested' files a request for approval. */
  joinOutcome: z.enum(['joined', 'requested', 'blocked']),
  canJoin: z.boolean(),
  /** Read the content inside. Distinct from being able to see the container. */
  canRead: z.boolean(),
  /** Produce anything inside it. `canPost` and `canComment` refine this. */
  canWrite: z.boolean(),
  canPost: z.boolean(),
  canComment: z.boolean(),
  /** Leave without stranding the container — false for an owner who must transfer. */
  canLeave: z.boolean(),
  canInvite: z.boolean(),
  canModerate: z.boolean(),
  canManage: z.boolean(),
});
export type ContainerViewerState = z.infer<typeof containerViewerStateSchema>;

// --- communities ------------------------------------------------------------

export const communitySchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  visibility: visibilitySchema,
  isOfficial: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  courseId: uuidSchema.nullable(),
  courseName: z.string().nullable(),
  viewer: containerViewerStateSchema,
});
export type Community = z.infer<typeof communitySchema>;

export const listCommunitiesQuerySchema = z.object({
  /** `mine` lists joined communities; `discover` lists in-scope ones. */
  scope: z.enum(['mine', 'discover']).default('discover'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const communityPageSchema = z.object({
  items: z.array(communitySchema),
  nextCursor: z.string().nullable(),
});

// --- groups -----------------------------------------------------------------

export const groupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  visibility: visibilitySchema,
  joinPolicy: joinPolicySchema,
  memberCount: z.number().int().nonnegative(),
  maxMembers: z.number().int().positive(),
  communityId: uuidSchema.nullable(),
  communityName: z.string().nullable(),
  courseId: uuidSchema.nullable(),
  courseName: z.string().nullable(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
  viewer: containerViewerStateSchema,
  /** Present only for moderators — the size of the approval queue. */
  pendingRequestCount: z.number().int().nonnegative().nullable(),
});
export type Group = z.infer<typeof groupSchema>;

export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).optional(),
  /**
   * `group` means unlisted — the group is invisible to everyone except members
   * and invitees, whatever their cohort.
   */
  visibility: z.enum(['stage', 'college', 'university', 'course', 'community', 'group']).default('stage'),
  joinPolicy: joinPolicySchema.default('request'),
  maxMembers: z.number().int().min(2).max(500).default(50),
  courseId: uuidSchema.optional(),
  communityId: uuidSchema.optional(),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const updateGroupRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  visibility: z
    .enum(['stage', 'college', 'university', 'course', 'community', 'group'])
    .optional(),
  joinPolicy: joinPolicySchema.optional(),
  maxMembers: z.number().int().min(2).max(500).optional(),
});

export const listGroupsQuerySchema = z.object({
  scope: z.enum(['mine', 'discover']).default('mine'),
  communityId: uuidSchema.optional(),
  courseId: uuidSchema.optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const groupPageSchema = z.object({
  items: z.array(groupSchema),
  nextCursor: z.string().nullable(),
});

export const joinGroupRequestSchema = z.object({
  /** Optional note to the moderators, for request-policy groups. */
  message: z.string().trim().max(500).optional(),
});

export const joinResultSchema = z.object({
  status: membershipStatusSchema,
  group: groupSchema,
});

export const groupMemberSchema = z.object({
  profile: profileSummarySchema,
  role: membershipRoleSchema,
  status: membershipStatusSchema,
  joinedAt: z.string().nullable(),
  requestedAt: z.string().nullable(),
  message: z.string().nullable(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const listMembersQuerySchema = z.object({
  status: membershipStatusSchema.default('active'),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const memberPageSchema = z.object({
  items: z.array(groupMemberSchema),
  nextCursor: z.string().nullable(),
});

export const updateMemberRequestSchema = z.object({
  role: membershipRoleSchema.optional(),
  /** Approving a request or rejecting it. */
  status: z.enum(['active', 'banned']).optional(),
});

export const inviteMemberRequestSchema = z.object({
  handle: z.string().min(3).max(30),
});

// --- search -----------------------------------------------------------------

export const searchKindSchema = z.enum(['all', 'people', 'content', 'groups', 'communities']);

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  kind: searchKindSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const searchResultsSchema = z.object({
  query: z.string(),
  people: z.array(profileSummarySchema),
  content: z.array(
    z.object({
      id: uuidSchema,
      body: z.string().nullable(),
      author: profileSummarySchema,
      createdAt: z.string(),
    }),
  ),
  groups: z.array(groupSchema),
  communities: z.array(communitySchema),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;
