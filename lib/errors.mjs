const errors = new Set(['invalid_request', 'unknown_field', 'invalid_text', 'project_mismatch',
  'bridge_not_ready', 'state_file_missing', 'state_file_exists',
  'publication_busy', 'unsafe_acl', 'posix_acl_check_unavailable',
  'codex_invalid_response', 'codex_response_too_large', 'codex_cancelled', 'codex_title_not_applied',
  'configuration_changed', 'request_id_conflict', 'session_not_found', 'not_accepted', 'invalid_host_response',
  'unsafe_file', 'unsafe_directory', 'invalid_config', 'root_changed_reregister', 'invalid_receipt',
  'config_version_unsupported_reregister', 'unknown_project', 'request_timeout_delivery_unknown']);
for (const error of ['invalid_create_request', 'creation_unknown_no_retry', 'invalid_creation_record',
  'invalid_created_session', 'workspace_not_found', 'codex_host_not_configured', 'invalid_codex_runtime',
  'codex_unavailable', 'codex_timeout', 'codex_disconnected', 'codex_thread_unavailable',
  'codex_initialize_failed', 'delivery_unknown_no_retry']) errors.add(error);
for (const error of ['invalid_codex_creation_policy', 'codex_creation_policy_stale', 'invalid_codex_creation_permission', 'invalid_dsh_creation_policy', 'dsh_permission_unavailable',
  'dsh_permission_verification_failed']) errors.add(error);

for (const error of ['state_directory_missing', 'windows_only', 'absolute_state_directory_required', 'windows_security_unavailable', 'windows_security_system_root_missing',
  'windows_security_spawn_failed', 'windows_security_timeout', 'windows_security_output_limit',
  'windows_security_exit_failed', 'windows_security_invalid_response', 'local_ntfs_required',
  'unsafe_binary', 'unsafe_reparse_point', 'atomic_move_failed', 'host_operation_failed',
  'invalid_host_operation', 'bridge_state_workspace_overlap', 'socket_exists', 'socket_path_too_long',
  'canonical_state_directory_required', 'bridge_startup_timeout', 'bridge_worker_failed']) errors.add(error);

// Never expose arbitrary exception messages, paths, prompts, or command output.
export function safeError(error, fallback = 'bridge_error') {
  const code = typeof error === 'string' ? error : error?.message;
  return errors.has(code) ? code : fallback;
}
