CREATE TABLE "entry_likes" (
	"entry_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entry_likes_entry_id_user_id_pk" PRIMARY KEY("entry_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "guide_likes" (
	"guide_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "guide_likes_guide_id_user_id_pk" PRIMARY KEY("guide_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "entry_likes" ADD CONSTRAINT "entry_likes_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_likes" ADD CONSTRAINT "entry_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_likes" ADD CONSTRAINT "guide_likes_guide_id_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_likes" ADD CONSTRAINT "guide_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_likes_user_id_idx" ON "entry_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "guide_likes_user_id_idx" ON "guide_likes" USING btree ("user_id");--> statement-breakpoint
-- The old like_count was a free-floating denormalised counter with no per-user
-- backing rows and could be inflated (see issue #109). The join tables start
-- empty, so the true count derived from them is 0 for every existing row. Reset
-- once here — explicitly and at deploy time — rather than letting the first
-- like/unlike per row silently recompute it to a surprising value later.
UPDATE "entries" SET "like_count" = 0;--> statement-breakpoint
UPDATE "guides" SET "like_count" = 0;
