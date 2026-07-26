/**
 * Hand-written descriptions for the most-used tools, merged over the OpenAPI
 * spec (Dokploy's spec ships no summaries/descriptions). Tools not listed
 * here fall back to "METHOD /path".
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  // Projects & environments
  project_all: "List all projects with their environments and services",
  project_one: "Get a single project by ID, including its services",
  project_create: "Create a new project",
  project_update: "Update project name or description",
  project_remove: "Delete a project and everything inside it",
  project_duplicate: "Duplicate a project or selected services",
  environment_byProjectId: "List environments of a project",
  environment_create: "Create an environment inside a project",
  environment_remove: "Delete an environment",

  // Applications
  application_one: "Get application details and current status",
  application_create: "Create a new application in an environment",
  application_update: "Update application settings",
  application_delete: "Delete an application permanently",
  application_deploy: "Trigger a deployment of the application",
  application_redeploy: "Redeploy the application (rebuild with latest source)",
  application_start: "Start a stopped application",
  application_stop: "Stop a running application",
  application_reload: "Restart the application container without rebuilding",
  application_saveEnvironment: "Set the application's environment variables (full replace)",
  application_saveBuildType: "Configure build type (dockerfile / nixpacks / buildpack / static)",
  application_saveGithubProvider: "Connect the application to a GitHub repository",
  application_saveGitProvider: "Connect the application to a plain git repository",
  application_saveDockerProvider: "Deploy the application from a prebuilt Docker image",
  application_readTraefikConfig: "Read the application's Traefik routing config",
  application_updateTraefikConfig: "Overwrite the application's Traefik routing config",
  application_cancelDeployment: "Cancel a queued deployment",
  application_readAppMonitoring: "Read CPU/memory monitoring data for the application",

  // Docker Compose services
  compose_one: "Get a Docker Compose service by ID",
  compose_create: "Create a new Docker Compose service",
  compose_update: "Update compose service settings, including the compose file",
  compose_delete: "Delete a compose service",
  compose_deploy: "Deploy the compose service",
  compose_redeploy: "Redeploy the compose service",
  compose_start: "Start the compose service",
  compose_stop: "Stop the compose service",
  compose_saveEnvironment: "Set environment variables for the compose service",
  compose_loadServices: "List service names defined in the compose file",

  // Deployments
  deployment_all: "List deployment history for an application",
  deployment_allByCompose: "List deployment history for a compose service",
  deployment_allByServer: "List deployments on a server",
  deployment_readLogs: "Read the build/deploy log of a deployment",
  deployment_killProcess: "Kill a running deployment process",

  // Docker containers
  docker_getContainers: "List Docker containers on a server",
  docker_getConfig: "Inspect a container (docker inspect)",
  docker_getContainersByAppNameMatch: "Find containers whose name matches an app name",
  docker_restartContainer: "Restart a Docker container",
  docker_startContainer: "Start a Docker container",
  docker_stopContainer: "Stop a Docker container",
  docker_killContainer: "Force-kill a Docker container",
  docker_removeContainer: "Remove a Docker container",

  // Domains & SSL
  domain_byApplicationId: "List domains attached to an application",
  domain_byComposeId: "List domains attached to a compose service",
  domain_create: "Add a domain to an app/compose (Traefik routing + optional Let's Encrypt)",
  domain_update: "Update a domain's settings",
  domain_delete: "Remove a domain",
  domain_generateDomain: "Generate a free traefik.me domain for a service",
  domain_validateDomain: "Check that the domain's DNS points to the server",

  // Settings & maintenance
  settings_health: "Health check of the Dokploy panel",
  settings_getDokployVersion: "Get the installed Dokploy version",
  settings_getIp: "Get the server's public IP",
  settings_getOpenApiDocument: "Get the full OpenAPI spec of this Dokploy instance",
  settings_checkInfrastructureHealth: "Check health of Dokploy infrastructure (Traefik, Redis, DB)",
  settings_getDockerDiskUsage: "Get Docker disk usage (images, containers, volumes)",
  settings_cleanUnusedImages: "Remove unused Docker images to free disk space",
  settings_cleanStoppedContainers: "Remove stopped Docker containers",
  settings_reloadTraefik: "Restart the Traefik proxy",

  // Servers
  server_all: "List all remote servers",
  server_one: "Get a remote server by ID",
  server_create: "Register a new remote server",
  server_getServerMetrics: "Get CPU/memory/disk metrics for a server",
  server_validate: "Validate SSH connectivity to a server",

  // Backups & rollbacks
  backup_create: "Create a backup configuration for a database",
  backup_one: "Get a backup configuration by ID",
  backup_update: "Update a backup configuration",
  backup_remove: "Delete a backup configuration",
  backup_listBackupFiles: "List backup files stored in the destination",
  rollback_rollback: "Roll back an application to a previous deployment",

  // Schedules
  schedule_list: "List scheduled tasks",
  schedule_create: "Create a scheduled task (cron)",
  schedule_update: "Update a scheduled task",
  schedule_delete: "Delete a scheduled task",
  schedule_runManually: "Run a scheduled task immediately",

  // Misc
  certificates_all: "List SSL certificates",
  sshKey_all: "List SSH keys",
  sshKey_generate: "Generate a new SSH key pair",
  user_all: "List users of the organization",
  user_get: "Get the current user",
  user_createApiKey: "Create an API key for the current user",
  notification_all: "List configured notification channels",
  previewDeployment_all: "List preview deployments of an application",
  auditLog_all: "Read the audit log",
};

// Same lifecycle verbs across all database engines — generate instead of repeating
const DB_ENGINES: Record<string, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongo: "MongoDB",
  redis: "Redis",
};

for (const [prefix, label] of Object.entries(DB_ENGINES)) {
  Object.assign(TOOL_DESCRIPTIONS, {
    [`${prefix}_one`]: `Get a ${label} service by ID`,
    [`${prefix}_create`]: `Create a ${label} database service`,
    [`${prefix}_deploy`]: `Deploy the ${label} service`,
    [`${prefix}_start`]: `Start the ${label} service`,
    [`${prefix}_stop`]: `Stop the ${label} service`,
    [`${prefix}_remove`]: `Delete the ${label} service`,
    [`${prefix}_saveEnvironment`]: `Set environment variables for the ${label} service`,
    [`${prefix}_changePassword`]: `Change the ${label} service password`,
    [`${prefix}_readLogs`]: `Read logs of the ${label} service`,
  });
}
