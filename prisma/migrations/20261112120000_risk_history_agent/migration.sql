-- Agenten (Taktline-CLI) haben kein Taktline-Konto; ihr GitLab-Username steht hier.
ALTER TABLE "RiskHistory" ADD COLUMN "agent" TEXT;
