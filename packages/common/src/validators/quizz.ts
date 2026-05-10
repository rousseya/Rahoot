import z from "zod";

const quizzQuestionValidator = z
  .object({
    question: z.string().min(1, "Question is required"),
    image: z.string().url().optional(),
    video: z.string().url().optional(),
    audio: z.string().url().optional(),
    "answer-image": z.string().url().optional(),
    answers: z.array(z.string().min(1, "Answer cannot be empty")).min(2),
    solution: z.number().int().min(0),
    cooldown: z.number().int().min(1),
    time: z.number().int().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.solution >= value.answers.length) {
      ctx.addIssue({
        code: "custom",
        path: ["solution"],
        message: "Solution index is out of range",
      });
    }
  });

export const quizzValidator = z.object({
  subject: z.string().min(1, "Subject is required"),
  questions: z
    .array(quizzQuestionValidator)
    .min(1, "At least one question is required"),
});

export type QuizzInput = z.infer<typeof quizzValidator>;
