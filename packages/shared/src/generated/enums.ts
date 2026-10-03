// Generiert aus docs/contracts – nicht von Hand ändern (pnpm contracts:generate).

export const roles = ["owner","admin","user"] as const;
export type Role = (typeof roles)[number];

export const superUserRoles = ["super_user"] as const;
export type SuperUserRole = (typeof superUserRoles)[number];

export const authContexts = ["tenant","system","select"] as const;
export type AuthContextKind = (typeof authContexts)[number];

export const permissionActions = ["catalog.read","equipment.read","equipment.write","project.read","project.create","project.update","project.delete","project.submit","project.withdraw","project.rank","queue.read","queue.vote","queue.decide","project.status","rig.settings.write","simulation.run","nina.instance.manage","nina.instance.read","session.read","session.correct","session.review","sessionlog.write","transit.result.import","project.note.write","project.history.read","member.directory","member.manage","member.admin.manage","member.leave","tenant.owner.transfer","tenant.settings","tenant.export","tenant.import","system.manage","system.tenant.owner","changeRequest.create","changeRequest.update","transit.lock","session.report.resend","notification.read","me.preferences","me.favorites","job.read","nina.sync","public"] as const;
export type PermissionAction = (typeof permissionActions)[number];

export const approvalStatuses = ["draft","submitted","approved","returned","rejected"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const approvalActions = ["submitted","withdrawn","approved","returned","rejected","expired","edited_by_admin"] as const;
export type ApprovalAction = (typeof approvalActions)[number];

export const projectStatuses = ["planning","active","on_hold","ready_to_process","unfinished","completed","archived"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const projectTypes = ["deep_sky","exoplanet"] as const;
export type ProjectType = (typeof projectTypes)[number];

export const changeRequestStatuses = ["open","approved","rejected","withdrawn"] as const;
export type ChangeRequestStatus = (typeof changeRequestStatuses)[number];

export const voteSubjectKinds = ["project","change_request"] as const;
export type VoteSubjectKind = (typeof voteSubjectKinds)[number];

export const effortTags = ["single_night","multi_night","not_feasible","transit"] as const;
export type EffortTag = (typeof effortTags)[number];

export const twilight = ["astronomical","nautical","civil"] as const;
export type TwilightValue = (typeof twilight)[number];

export const moonModes = ["profile","project_default","none"] as const;
export type MoonMode = (typeof moonModes)[number];

export const moonProfileBuiltins = ["moonProfile.none","moonProfile.strict","moonProfile.moderate","moonProfile.relaxed"] as const;
export type MoonProfileBuiltin = (typeof moonProfileBuiltins)[number];

export const filterTypes = ["broadband","narrowband","luminance","uv_ir_cut","light_pollution","photometric","other"] as const;
export type FilterType = (typeof filterTypes)[number];

export const photometricBands = ["U","B","V","Rc","Ic","g","r","i","z","clear","lum","none"] as const;
export type PhotometricBand = (typeof photometricBands)[number];

export const observatoryTypes = ["open_air","dome","roll_off_roof","fixed_pier","portable","remote_hosted"] as const;
export type ObservatoryType = (typeof observatoryTypes)[number];

export const opticalDesigns = ["apochromatic_refractor","achromat","newtonian","rc","sct","maksutov","cdk","cassegrain","rasa"] as const;
export type OpticalDesign = (typeof opticalDesigns)[number];

export const strategies = ["proportional","manual_priority"] as const;
export type Strategy = (typeof strategies)[number];

export const playbackModes = ["time_aware","sequential"] as const;
export type PlaybackMode = (typeof playbackModes)[number];

export const sortChainKeys = ["lowest_peak_altitude","setting_soonest","most_remaining","constrained","most_moon_limited","mosaic_grouping","card_order","due_soonest"] as const;
export type SortChainKey = (typeof sortChainKeys)[number];

export const planOrigins = ["forecast_job","plugin_offline","server_plan","web_simulation"] as const;
export type PlanOrigin = (typeof planOrigins)[number];

export const planReasons = ["initial","refresh","resume","reset","simulation","forecast"] as const;
export type PlanReason = (typeof planReasons)[number];

export const planCmds = ["slew_center_rotate","slew_center","filter","expose","expose_series","dither","wait","meridian_flip","autofocus_hint","end"] as const;
export type PlanCmd = (typeof planCmds)[number];

export const blockKinds = ["regular","transit"] as const;
export type BlockKind = (typeof blockKinds)[number];

export const rotationModes = ["rotator","fixed_camera"] as const;
export type RotationMode = (typeof rotationModes)[number];

export const diagnosticReasons = ["start_date","not_visible","below_min_time","moon_blocked","prefiltered","outranked","no_need","transit_conflict","flip_in_transit","filter_not_found","rotation_mismatch"] as const;
export type DiagnosticReason = (typeof diagnosticReasons)[number];

export const sessionStatuses = ["running","completed","aborted","stale"] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const reportStatuses = ["none","pending","sent","failed","skipped"] as const;
export type ReportStatus = (typeof reportStatuses)[number];

export const sessionEventKinds = ["plan_built","plan_rebuilt","block_start","block_end","block_skipped","center_failed","safety_pause","safety_resume","transit_start","transit_end","af","flip","flats_start","flats_end","rotation_mismatch","lease_conflict","lease_lost","flip_settings_mismatch","filter_not_found","readout_mode_not_found","trigger_suppressed","offline_start","offline_end","warning","error","session_end","lease_regained","rotation_unknown","flip_undetected","skipped_timeaware","past_mismatch"] as const;
export type SessionEventKind = (typeof sessionEventKinds)[number];

export const heartbeatStates = ["running","idle","paused","flats","offline","blocked"] as const;
export type HeartbeatState = (typeof heartbeatStates)[number];

export const frameTypes = ["light","flat","dark_flat"] as const;
export type FrameType = (typeof frameTypes)[number];

export const captureResults = ["saved","aborted","failed"] as const;
export type CaptureResult = (typeof captureResults)[number];

export const captureAssignments = ["assigned","unassigned"] as const;
export type CaptureAssignment = (typeof captureAssignments)[number];

export const captureIngestStatuses = ["accepted","duplicate","archived","unassigned","rejected_invalid"] as const;
export type CaptureIngestStatus = (typeof captureIngestStatuses)[number];

export const pierSides = ["east","west"] as const;
export type PierSide = (typeof pierSides)[number];

export const rejectReasons = ["clouds","wind","focus","satellite","guiding","other"] as const;
export type RejectReason = (typeof rejectReasons)[number];

export const deviationReasons = ["center_failed","block_skipped","safety_pause","transit","autofocus","meridian_flip","exposure_aborted","exposure_failed","skipped_timeaware","device_error","lease_lost"] as const;
export type DeviationReason = (typeof deviationReasons)[number];

export const transitObservationStatuses = ["requested","locked","observed","missed","cancelled"] as const;
export type TransitObservationStatus = (typeof transitObservationStatuses)[number];

export const transitResultFormats = ["hops","exotic","manual"] as const;
export type TransitResultFormat = (typeof transitResultFormats)[number];

export const ninaInstanceStatuses = ["active","revoked"] as const;
export type NinaInstanceStatus = (typeof ninaInstanceStatuses)[number];

export const ninaCommands = ["refresh_targets","reset_plan"] as const;
export type NinaCommand = (typeof ninaCommands)[number];

export const jobKinds = ["multi_sim","impact","effort","session_close","session_report","discord_post","export","import","thumbnail","transit_result_parse","catalog_refresh","forecast","reconcile","weather","noop"] as const;
export type JobKind = (typeof jobKinds)[number];

export const jobStatuses = ["pending","running","done","failed"] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const schedules = ["tick-5min","tick-hourly","daily","weekly"] as const;
export type Schedule = (typeof schedules)[number];

export const discordCategories = ["approvals","sessions","alerts"] as const;
export type DiscordCategory = (typeof discordCategories)[number];

export const discordEventKeys = {
  "approvals": [
    "submission.new",
    "submission.withdrawn",
    "approval.approved",
    "approval.returned",
    "approval.rejected",
    "approval.expired",
    "deadline.near",
    "change_request.new",
    "change_request.decided"
  ],
  "sessions": [
    "session.started",
    "session.completed",
    "session.stale",
    "transit.observed",
    "transit.missed",
    "session.report"
  ],
  "alerts": [
    "session.no_heartbeat",
    "plugin.dead_letters",
    "rig.busy",
    "nina.settings_mismatch",
    "discord.channel_failed"
  ]
} as const;

export const notificationKinds = ["submission.new","submission.withdrawn","submission.edited_by_admin","approval.approved","approval.returned","approval.rejected","approval.expired","deadline.near","change_request.new","change_request.decided","vote.subject_changed","vote.subject_resubmitted","project.completed","transit.confirmation_needed","transit.confirmed","transit.declined","transit.expired","role.changed","owner.reassigned","alert.rig_busy","alert.session_no_heartbeat","alert.plugin_dead_letters","alert.nina_settings_mismatch","alert.discord_channel_failed"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const catalogs = ["dso","exoclock","nasa","toi"] as const;
export type Catalog = (typeof catalogs)[number];

export const exoTimeSystemSources = ["bjd_tdb","bjd_utc","hjd_utc","jd_utc","btjd","bkjd","unknown"] as const;
export type ExoTimeSystemSource = (typeof exoTimeSystemSources)[number];

export const exoDepthUnits = ["percent","ppm","mmag"] as const;
export type ExoDepthUnit = (typeof exoDepthUnits)[number];

export const exoPriorities = ["alert","high","medium","low"] as const;
export type ExoPriority = (typeof exoPriorities)[number];

export const dsoObjectTypes = ["G","GPair","GTrpl","GGroup","OCl","GCl","Cl+N","PN","HII","DrkN","EmN","Neb","RfN","SNR","*","**","*Ass","Nova","Dup","NonEx","Other"] as const;
export type DsoObjectType = (typeof dsoObjectTypes)[number];

export const dsoCatalogPrefixes = ["M","NGC","IC","C","Sh2","LBN","LDN","B","PGC","UGC","ESO","Mel","Cl"] as const;
export type DsoCatalogPrefix = (typeof dsoCatalogPrefixes)[number];

export const dsoObjectTypeGroups = {
  "G": "galaxy",
  "GPair": "galaxy",
  "GTrpl": "galaxy",
  "GGroup": "galaxy",
  "OCl": "open_cluster",
  "GCl": "globular_cluster",
  "Cl+N": "open_cluster",
  "PN": "planetary_nebula",
  "HII": "emission_nebula",
  "EmN": "emission_nebula",
  "Neb": "emission_nebula",
  "RfN": "reflection_nebula",
  "DrkN": "dark_nebula",
  "SNR": "supernova_remnant",
  "**": "multiple_star",
  "*": "other",
  "*Ass": "other",
  "Nova": "other",
  "Dup": "other",
  "NonEx": "other",
  "Other": "other"
} as const;

export const weatherModels = ["d2","eu","global","dini","hrrr","gem","gfs"] as const;
export type WeatherModel = (typeof weatherModels)[number];

export const cloudSources = ["dini","gem"] as const;
export type CloudSource = (typeof cloudSources)[number];

export const correctionSources = ["nina","correction","import"] as const;
export type CorrectionSource = (typeof correctionSources)[number];

export const sessionLogSources = ["forecast","nina","manual","auto"] as const;
export type SessionLogSource = (typeof sessionLogSources)[number];

export const siteNightStatSources = ["session","manual"] as const;
export type SiteNightStatSource = (typeof siteNightStatSources)[number];

export const sortChainDefault = ["lowest_peak_altitude","setting_soonest","most_remaining","constrained"] as const;
export type SortChainDefaultValue = (typeof sortChainDefault)[number];

export const simulatorWarnings = ["idle_gap","la_unsafe","total_min","no_alloc","la_miss","filter_stuck","past_mismatch","panel_rotation_mismatch","twilight_grazing"] as const;
export type SimulatorWarning = (typeof simulatorWarnings)[number];

export const warningLevels = ["warn","error"] as const;
export type WarningLevel = (typeof warningLevels)[number];

export const blockSkipReasons = ["elapsed","no_exposures","not_viable","center_failed","user_skip","rotation_mismatch","filter_not_found","lease_lost"] as const;
export type BlockSkipReason = (typeof blockSkipReasons)[number];

export const blockEndReasons = ["completed","target_removed","transit_interrupt","user_skip","lease_lost","night_end","error","interrupted","replanned"] as const;
export type BlockEndReason = (typeof blockEndReasons)[number];

export const pluginWarningCodes = ["camera_temperature","nina_dither_trigger_present","rotator_unavailable","trained_flat_position_changed","flat_exposure_off","filter_wheel_changed","mount_site_mismatch","pc_timezone_differs","optics_mirrored","image_not_saved","rotator_range_quarter","safety_monitor_not_connected","sequence_template_deviation","loop_guard","clock_drift"] as const;
export type PluginWarningCode = (typeof pluginWarningCodes)[number];

export const ninaSettingsMismatchCodes = ["flip_trigger_missing","flip_timing_mismatch","recenter_after_flip_on","rotator_unavailable","rotator_range_quarter","plate_solve_tolerance","mount_epoch_unsupported","mount_site_mismatch","nina_dither_trigger_present","af_time_trigger_missing","af_time_mismatch","filter_wheel_changed"] as const;
export type NinaSettingsMismatchCode = (typeof ninaSettingsMismatchCodes)[number];

export const flatCombinationStatuses = ["pending","running","done","skipped"] as const;
export type FlatCombinationStatus = (typeof flatCombinationStatuses)[number];

export const flatsSources = ["panel","sky"] as const;
export type FlatsSource = (typeof flatsSources)[number];

export const projectStatusTransitions = {
  "planning": [
    "active",
    "on_hold",
    "archived"
  ],
  "active": [
    "on_hold",
    "ready_to_process",
    "unfinished",
    "archived"
  ],
  "on_hold": [
    "active",
    "archived"
  ],
  "ready_to_process": [
    "active",
    "completed",
    "archived"
  ],
  "unfinished": [
    "active",
    "archived"
  ],
  "completed": [
    "active",
    "archived"
  ],
  "archived": [
    "active"
  ]
} as const;

export const tenantStatuses = ["active","locked"] as const;
export type TenantStatus = (typeof tenantStatuses)[number];

export const identityStatuses = ["active","blocked"] as const;
export type IdentityStatus = (typeof identityStatuses)[number];

export const superUserStatuses = ["active","disabled"] as const;
export type SuperUserStatus = (typeof superUserStatuses)[number];

export const memberStatuses = ["active","disabled","removed"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const changeLogActions = ["create","update","delete","restore","status_change","role_change","settings_change"] as const;
export type ChangeLogAction = (typeof changeLogActions)[number];

export const blockedReasons = ["lease_lost","rig_busy","token_invalid","clock_skew","plan_failed","engine_incompatible","tenant_locked"] as const;
export type BlockedReason = (typeof blockedReasons)[number];

export const tenantSettingsKeys = ["tenantTimezone","userCorrections","exoUserLockNeedsAdmin","exoUserMaxOpenLocks","autoReactivateOnRemaining","autoReadyToProcess","adminSelfApproval","approvalDeadlineDays","defaultLanguage"] as const;
export type TenantSettingsKey = (typeof tenantSettingsKeys)[number];

export const systemSettingKeys = ["maintenanceBanner","exoPrefilter"] as const;
export type SystemSettingKey = (typeof systemSettingKeys)[number];

export const uploadPurposes = ["transit_result","tenant_import","plan_log"] as const;
export type UploadPurpose = (typeof uploadPurposes)[number];

export const downloadPurposes = ["job_result","export"] as const;
export type DownloadPurpose = (typeof downloadPurposes)[number];
