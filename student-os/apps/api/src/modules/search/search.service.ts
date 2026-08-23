import type { Locale, MembershipRole, MembershipStatus, SearchKind, SearchResults } from '@sos/contracts';
import {
  canDiscoverGroup,
  canJoinClassroom,
  canReadClassroom,
  canViewClassroom,
  canViewCommunity,
  MIN_QUESTIONS_FOR_CONFIDENCE,
  visibilityScopesFor,
  type Actor,
  type ClassroomRef,
  type MaybeMembership,
} from '@sos/core';
import { toMembership as toCommunityMembership, toRef } from '../communities/communities.repository.js';
import { toGroupRef, toMembership } from '../groups/groups.repository.js';
import * as repo from './search.repository.js';

/**
 * Search orchestration.
 *
 * Runs the six searches concurrently and re-checks each permissioned result
 * set through the policy layer. The SQL already filters; running the policy
 * again is defence in depth, and it makes any divergence between the query and
 * the policy show up as a missing result rather than as a leak.
 *
 * Topics are academic reference data, not a container, so they have no second
 * policy pass — the same rule `GET /v1/topics/:id` already follows.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

function toClassroomRef(row: repo.ClassroomHit): ClassroomRef {
  return {
    id: row.id,
    courseId: row.course_id,
    instructorId: row.instructor_id,
    visibility: row.visibility as ClassroomRef['visibility'],
    isArchived: row.is_archived,
  };
}

function toClassroomMembership(row: repo.ClassroomHit): MaybeMembership {
  if (!row.viewer_status || !row.viewer_role) return null;
  return {
    role: row.viewer_role as MembershipRole,
    status: row.viewer_status as MembershipStatus,
  };
}

export async function search(
  actor: Actor,
  query: { q: string; kind: SearchKind; limit: number },
  locale: Locale,
): Promise<SearchResults> {
  const scopes = visibilityScopesFor(actor);
  const wants = (kind: string): boolean => query.kind === 'all' || query.kind === kind;

  /*
   * Normalised once, here, and passed to all six searches.
   *
   * Doing it per-repository would let one branch drift, and the drift would be
   * invisible: Arabic search would work for people and quietly not for topics.
   */
  const term = repo.prepareTerm(query.q);

  /*
   * Mutes are deliberately NOT applied to search.
   *
   * A mute silences an ambient surface — it is a request to stop hearing from
   * someone in passing. A search is an explicit request for a specific thing,
   * and hiding a muted person from a query for their own name would be a
   * feature nobody asked for and no UI could explain. Blocking is the tool that
   * makes someone unfindable, and it is applied here (via
   * `scopes.excludedUserIds`).
   */
  const [people, content, groups, communities, topics, classrooms] = await Promise.all([
    wants('people') ? repo.searchPeople(term, scopes, query.limit) : Promise.resolve([]),
    wants('content') ? repo.searchContent(term, scopes, query.limit) : Promise.resolve([]),
    wants('groups') ? repo.searchGroups(term, scopes, query.limit) : Promise.resolve([]),
    wants('communities')
      ? repo.searchCommunities(term, scopes, query.limit)
      : Promise.resolve([]),
    wants('topics') ? repo.searchTopics(term, scopes, query.limit) : Promise.resolve([]),
    wants('classrooms') ? repo.searchClassrooms(term, scopes, query.limit) : Promise.resolve([]),
  ]);

  return {
    query: query.q,
    people: people.map((person) => ({
      userId: person.user_id,
      handle: person.handle,
      displayName: person.display_name,
      avatarUrl: person.avatar_url,
      verificationLevel: person.verification_level,
      stageName: localised(person.stage_name_ar, person.stage_name_en, locale),
      collegeName: localised(person.college_name_ar, person.college_name_en, locale),
    })),
    content: content.map((hit) => ({
      id: hit.id,
      body: hit.body,
      createdAt: hit.created_at.toISOString(),
      author: {
        userId: hit.author_id,
        handle: hit.handle,
        displayName: hit.display_name,
        avatarUrl: hit.avatar_url,
        verificationLevel: hit.verification_level,
        stageName: localised(hit.stage_name_ar, hit.stage_name_en, locale),
        collegeName: localised(hit.college_name_ar, hit.college_name_en, locale),
      },
    })),
    groups: groups
      // Second pass through the policy. A group the query returned but the
      // policy refuses is a divergence, and dropping it here is the safe
      // direction to fail.
      .filter((row) => {
        const membership = toMembership(row);
        return (
          membership?.status === 'active' ||
          canDiscoverGroup(actor, toGroupRef(row), membership).allowed
        );
      })
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        avatarUrl: row.avatar_url,
        visibility: row.visibility,
        joinPolicy: row.join_policy,
        memberCount: row.member_count,
        maxMembers: row.max_members,
        communityId: row.community_id,
        communityName: localised(row.community_name_ar, row.community_name_en, locale),
        courseId: row.course_id,
        courseName: localised(row.course_name_ar, row.course_name_en, locale),
        createdAt: row.created_at.toISOString(),
        archivedAt: row.archived_at?.toISOString() ?? null,
        viewer: {
          membershipStatus: toMembership(row)?.status ?? null,
          role: toMembership(row)?.role ?? null,
          // Search results are for navigation, not for acting on. The client
          // opens the group and gets the real affordances from that response —
          // so every gate is reported closed here rather than guessed at.
          joinOutcome: 'blocked' as const,
          canJoin: false,
          canRead: false,
          canWrite: false,
          canPost: false,
          canComment: false,
          canLeave: false,
          canInvite: false,
          canModerate: false,
          canManage: false,
        },
        pendingRequestCount: null,
      })),
    communities: communities
      .filter((row) => canViewCommunity(actor, toRef(row)).allowed)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: localised(row.name_ar, row.name_en, locale) ?? row.slug,
        description: row.description,
        coverUrl: row.cover_url,
        visibility: row.visibility,
        isOfficial: row.is_official,
        memberCount: row.member_count,
        courseId: row.course_id,
        courseName: localised(row.course_name_ar, row.course_name_en, locale),
        viewer: {
          membershipStatus: toCommunityMembership(row)?.status ?? null,
          role: toCommunityMembership(row)?.role ?? null,
          joinOutcome: 'blocked' as const,
          canJoin: false,
          canRead: false,
          canWrite: false,
          canPost: false,
          canComment: false,
          canLeave: false,
          canInvite: false,
          canModerate: false,
          canManage: false,
        },
      })),
    topics: topics.map((row) => {
      const seen = row.questions_seen ?? 0;
      return {
        id: row.id,
        name: localised(row.name_ar, row.name_en, locale) ?? row.name_en,
        subjectName: localised(row.subject_name_ar, row.subject_name_en, locale) ?? row.subject_name_en,
        courseName: localised(row.course_name_ar, row.course_name_en, locale) ?? row.course_name_en,
        viewer:
          seen > 0
            ? {
                questionsSeen: seen,
                questionsCorrect: row.questions_correct ?? 0,
                lowConfidence: seen < MIN_QUESTIONS_FOR_CONFIDENCE,
              }
            : null,
      };
    }),
    classrooms: classrooms
      .filter((row) => {
        const membership = toClassroomMembership(row);
        return canViewClassroom(actor, toClassroomRef(row), membership).allowed;
      })
      .map((row) => {
        const classroom = toClassroomRef(row);
        const membership = toClassroomMembership(row);
        return {
          id: row.id,
          title: row.title,
          courseName: localised(row.course_name_ar, row.course_name_en, locale),
          courseCode: row.course_code,
          memberCount: row.member_count,
          viewer: {
            isMember: membership?.status === 'active',
            canRead: canReadClassroom(actor, membership).allowed,
            canJoin: canJoinClassroom(actor, {
              classroom,
              membership,
              hasValidJoinCode: false,
            }).allowed,
          },
        };
      }),
  };
}
