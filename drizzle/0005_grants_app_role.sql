-- Grants da aplicação (usuário estoque_app) — versionados a partir da Fase 6.
-- Antes eram aplicados à mão no banco de desenvolvimento; o banco de teste
-- (estoque_test) nascia sem permissão e os testes de integração falhavam.
-- O DO protege ambientes onde o papel não existe (ex.: Neon, app é o dono).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estoque_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estoque_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO estoque_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoque_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO estoque_app';
  END IF;
END $$;
