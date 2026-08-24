DROP INDEX "seats_unique_position";--> statement-breakpoint
CREATE UNIQUE INDEX "seats_unique_position" ON "seats" USING btree ("event_id","section_id","row_label","seat_no");