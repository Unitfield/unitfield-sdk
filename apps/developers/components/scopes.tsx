import { getPublicApi } from "@/lib/public-api/load";

/** The scopes an API's token can be granted, read from the published document, so the table cannot drift from the operations. */
export function Scopes({ surface }: { surface: string }) {
  const document = getPublicApi().documents[surface];
  const flows = document?.components?.securitySchemes?.OAuth2?.flows;
  const scopes: Record<string, string> = flows?.clientCredentials?.scopes ?? flows?.authorizationCode?.scopes ?? {};
  const rows = Object.entries(scopes);
  if (rows.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>Scope</th>
          <th>Lets the app</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([scope, description]) => (
          <tr key={scope}>
            <td>
              <code>{scope}</code>
            </td>
            <td>{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
