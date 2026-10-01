ALTER TABLE "invitations" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "inviter_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;