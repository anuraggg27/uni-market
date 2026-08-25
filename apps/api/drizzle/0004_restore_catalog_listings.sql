UPDATE "listing_images"
SET
	"synthetic_status" = 'SYNTHETIC_OR_MATERIALLY_ALTERED',
	"synthetic_declared_at" = COALESCE("synthetic_declared_at", now())
WHERE "deleted_at" IS NULL
	AND "listing_id" IN (
		'78047eab-0ef2-4933-a204-65b9cd8b47ee',
		'dd455ad2-0267-47b1-ad34-ff5c73082cc7',
		'e5e4e81d-1cbe-4549-a701-791d452a72a0',
		'b53e3361-9870-4e8f-a631-a4304c0c1fc2',
		'122462ea-1262-45b7-a4dd-a6a10513ea7a',
		'994c092d-ea32-436c-ad11-9198636d73c4',
		'63360449-e317-48a9-aab6-948e49d8323d',
		'78d4331b-ccbf-4514-a09d-578f332bc6df',
		'86bbc6d9-976c-4cfd-a79d-a53c7a95ea56',
		'9f0786af-7a6e-497d-af2f-2b3e7536a8ad',
		'a00438e8-5b8b-4986-a684-d4266c2836d2',
		'800d47fc-e7b8-4685-ad5b-607bb3d6e6d3',
		'5e1ec65b-ec8f-4b80-a35f-79e889f5a929',
		'2a160180-43ed-4c64-a717-411725912732',
		'82c61efa-ba55-44c5-acc5-57013fdfdbfe',
		'f8844eb3-c7ac-4af6-a7b3-080424dbd7af',
		'a4fda22d-3604-49eb-a32d-56aecb665b2f',
		'81ac30a6-01b9-469c-a9e1-112b482cd77d',
		'ee739d63-0821-4c18-aea3-7af30a49be25',
		'62f23688-b755-47bf-a836-534a25884a9a'
	);--> statement-breakpoint
UPDATE "listings"
SET
	"moderation_state" = 'APPROVED',
	"lifecycle_state" = 'ACTIVE',
	"approved_at" = "created_at",
	"seller_attested_at" = COALESCE("seller_attested_at", now()),
	"seller_policy_version" = '2026-08-25',
	"rejection_reason" = NULL,
	"requested_changes" = NULL,
	"updated_at" = now()
WHERE "deleted_at" IS NULL
	AND "moderation_state" = 'PENDING'
	AND "lifecycle_state" = 'DRAFT'
	AND "requested_changes" = 'Please reconfirm the seller declarations and declare whether each image is AI-generated or materially altered.'
	AND "id" IN (
		'78047eab-0ef2-4933-a204-65b9cd8b47ee',
		'dd455ad2-0267-47b1-ad34-ff5c73082cc7',
		'e5e4e81d-1cbe-4549-a701-791d452a72a0',
		'b53e3361-9870-4e8f-a631-a4304c0c1fc2',
		'122462ea-1262-45b7-a4dd-a6a10513ea7a',
		'994c092d-ea32-436c-ad11-9198636d73c4',
		'63360449-e317-48a9-aab6-948e49d8323d',
		'78d4331b-ccbf-4514-a09d-578f332bc6df',
		'86bbc6d9-976c-4cfd-a79d-a53c7a95ea56',
		'9f0786af-7a6e-497d-af2f-2b3e7536a8ad',
		'a00438e8-5b8b-4986-a684-d4266c2836d2',
		'800d47fc-e7b8-4685-ad5b-607bb3d6e6d3',
		'5e1ec65b-ec8f-4b80-a35f-79e889f5a929',
		'2a160180-43ed-4c64-a717-411725912732',
		'82c61efa-ba55-44c5-acc5-57013fdfdbfe',
		'f8844eb3-c7ac-4af6-a7b3-080424dbd7af',
		'a4fda22d-3604-49eb-a32d-56aecb665b2f',
		'81ac30a6-01b9-469c-a9e1-112b482cd77d',
		'ee739d63-0821-4c18-aea3-7af30a49be25',
		'62f23688-b755-47bf-a836-534a25884a9a'
	);
