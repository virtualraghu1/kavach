# Controlled owner bootstrap

This command links one existing, exact Supabase Auth user to the first Kavach
owner account. It does not create an Auth user, choose a password or enable
public signup. Create the Auth identity through an authorised administrative
path so the owner chooses the permanent password privately.

The database migration must be reviewed and installed in the target environment
before running the command. Use a fresh UUID for `KAVACH_BOOTSTRAP_OPERATION_ID`;
reusing that UUID with the same Auth user is an idempotent retry. The command
requires an exact confirmation string and refuses the known production project
unless `KAVACH_ALLOW_PRODUCTION_BOOTSTRAP=YES` is also present.

Required environment variables are documented in
[`../supabase/bootstrap.env.example`](../supabase/bootstrap.env.example). Never
put real values in a tracked file or shell history. Run with Deno environment
and network permissions only after independently confirming the target project,
Auth user ID and username.

The command prints only project, Auth-user, account-link and idempotency status
identifiers. It does not print email addresses, passwords, tokens or service
credentials.
