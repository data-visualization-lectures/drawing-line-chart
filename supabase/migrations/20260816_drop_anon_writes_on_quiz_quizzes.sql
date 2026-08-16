-- New writes go through publish-drawing-line-chart-quiz (service role).
-- Public SELECT stays so quiz.html can keep reading existing ids.
-- quiz_responses INSERT is unchanged: answering remains a public write.

DROP POLICY IF EXISTS quiz_quizzes_insert ON public.quiz_quizzes;
DROP POLICY IF EXISTS "Anyone can create quizzes" ON public.quiz_quizzes;
