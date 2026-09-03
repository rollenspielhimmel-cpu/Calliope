import { WordFilterService } from "@/src/service/word_filter_service.ts";
import { db } from "@/src/database/client.ts";
import type { ProfileQuestionKind } from "@/src/database/schema.ts";

/**
 * The optional profile questions, defined by the operators rather than by a column each. The
 * seven fixed profile columns on `user` stay where they are — those are the ones the product
 * itself asks, and the interface reads them by name.
 *
 * **An unanswered question is absent, never empty.** There is no row for it, so a profile whose
 * questions are all unanswered shows no question section at all rather than a list of blanks.
 * That is the rule from the product document, and it is why answers are their own table instead
 * of nullable columns.
 */

export type ProfileQuestionOption = { id: string; label: string };

export type ProfileQuestion = {
  id: string;
  section: string;
  prompt: string;
  kind: ProfileQuestionKind;
  position: number;
  /** Empty for a `text` question. */
  options: ProfileQuestionOption[];
};

async function listQuestions(): Promise<ProfileQuestion[]> {
  const questions = await db
    .selectFrom("profileQuestion")
    .select(["id", "section", "prompt", "kind", "position"])
    .orderBy("section", "asc")
    .orderBy("position", "asc")
    .execute();

  if (questions.length === 0) {
    return [];
  }

  // One query for every question's options rather than one per question.
  const options = await db
    .selectFrom("profileQuestionOption")
    .select(["id", "questionId", "label"])
    .where("questionId", "in", questions.map((question) => question.id))
    .orderBy("position", "asc")
    .execute();

  const byQuestion = new Map<string, ProfileQuestionOption[]>();

  for (const option of options) {
    const list = byQuestion.get(option.questionId) ?? [];
    list.push({ id: option.id, label: option.label });
    byQuestion.set(option.questionId, list);
  }

  return questions.map((question) => ({
    ...question,
    options: byQuestion.get(question.id) ?? [],
  }));
}

/**
 * Writing the question and its options together, because a choice question with no options is
 * a question nobody can answer — the two are one edit, so they are one transaction.
 *
 * Options are replaced rather than merged. An option that goes away takes the answers pointing
 * at it with it, which is the honest outcome: an answer naming a choice that no longer exists
 * says nothing about the person who gave it.
 */
async function writeQuestion(
  question: {
    id?: string;
    section: string;
    prompt: string;
    kind: ProfileQuestionKind;
    position: number;
    options: string[];
  },
): Promise<string> {
  return await db.transaction().execute(async (transaction) => {
    const { section, prompt, kind, position } = question;

    const id = question.id === undefined
      ? (await transaction
        .insertInto("profileQuestion")
        .values({ section, prompt, kind, position })
        .returning("id")
        .executeTakeFirstOrThrow()).id
      : (await transaction
        .updateTable("profileQuestion")
        .set({ section, prompt, kind, position })
        .where("id", "=", question.id)
        .returning("id")
        .executeTakeFirstOrThrow()).id;

    await transaction
      .deleteFrom("profileQuestionOption")
      .where("questionId", "=", id)
      .execute();

    if (question.options.length > 0) {
      await transaction
        .insertInto("profileQuestionOption")
        .values(
          question.options.map((label, index) => ({
            questionId: id,
            label,
            position: index,
          })),
        )
        .execute();
    }

    return id;
  });
}

/** The answers go with it: they were answers to this question and to nothing else. */
async function deleteQuestion(id: string): Promise<"not_found" | undefined> {
  const deleted = await db
    .deleteFrom("profileQuestion")
    .where("id", "=", id)
    .returning("id")
    .executeTakeFirst();

  return deleted === undefined ? "not_found" : undefined;
}

export type ProfileAnswer = {
  questionId: string;
  section: string;
  prompt: string;
  /** What to show: the free text, or the label of the option that was chosen. */
  answer: string;
};

/** Only answered questions, which is what makes an unanswered one simply absent. */
async function listAnswersForUser(userId: string): Promise<ProfileAnswer[]> {
  const rows = await db
    .selectFrom("profileAnswer")
    .innerJoin(
      "profileQuestion",
      "profileQuestion.id",
      "profileAnswer.questionId",
    )
    .leftJoin(
      "profileQuestionOption",
      "profileQuestionOption.id",
      "profileAnswer.optionId",
    )
    .select([
      "profileQuestion.id as questionId",
      "profileQuestion.section",
      "profileQuestion.prompt",
      "profileAnswer.answerText",
      "profileQuestionOption.label as optionLabel",
    ])
    .where("profileAnswer.userId", "=", userId)
    .orderBy("profileQuestion.section", "asc")
    .orderBy("profileQuestion.position", "asc")
    .execute();

  const answers = rows
    .map((row) => ({
      questionId: row.questionId,
      section: row.section,
      prompt: row.prompt,
      answer: row.answerText ?? row.optionLabel ?? "",
    }))
    // A chosen option deleted between the answer and this read leaves nothing to show.
    .filter((answer) => answer.answer.length > 0);

  // Masked at the read, like every other prose surface. An option's label goes through it too:
  // telling the two apart here would mean the mask depended on which kind of answer it was, and
  // an administration-written label holding a blocked word is a mistake worth showing as masked.
  return await Promise.all(
    answers.map(async (answer) => ({
      ...answer,
      answer: await WordFilterService.maskText(answer.answer),
    })),
  );
}

/**
 * Every answer in one transaction, so a half-saved profile is not a state anybody can observe.
 * The withdrawals and the writes are each done as one statement rather than row by row.
 */
async function setAnswers(
  userId: string,
  answers: { questionId: string; text?: string; optionId?: string }[],
): Promise<void> {
  const written = answers
    .map((answer) => {
      const text = answer.text?.trim();
      const hasText = text !== undefined && text.length > 0;

      if (!hasText && answer.optionId === undefined) {
        return undefined;
      }

      return {
        userId,
        questionId: answer.questionId,
        answerText: hasText ? text : null,
        optionId: hasText ? null : answer.optionId ?? null,
      };
    })
    .filter((value) => value !== undefined);

  const writtenIds = new Set(written.map((answer) => answer.questionId));

  // Anything sent empty is withdrawn, and the question leaves the profile again.
  const withdrawn = answers
    .map((answer) => answer.questionId)
    .filter((questionId) => !writtenIds.has(questionId));

  await db.transaction().execute(async (transaction) => {
    if (withdrawn.length > 0) {
      await transaction
        .deleteFrom("profileAnswer")
        .where("userId", "=", userId)
        .where("questionId", "in", withdrawn)
        .execute();
    }

    if (written.length > 0) {
      await transaction
        .insertInto("profileAnswer")
        .values(written)
        .onConflict((conflict) =>
          conflict.columns(["userId", "questionId"]).doUpdateSet((eb) => ({
            answerText: eb.ref("excluded.answerText"),
            optionId: eb.ref("excluded.optionId"),
          }))
        )
        .execute();
    }
  });
}

export const ProfileQuestionService = {
  listQuestions,
  writeQuestion,
  deleteQuestion,
  listAnswersForUser,

  setAnswers,
};
