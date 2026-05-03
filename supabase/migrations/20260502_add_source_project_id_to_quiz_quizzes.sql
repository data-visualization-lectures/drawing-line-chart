alter table public.quiz_quizzes
  add column if not exists source_project_id uuid;

create unique index if not exists quiz_quizzes_source_project_id_unique
  on public.quiz_quizzes (source_project_id)
  where source_project_id is not null;
