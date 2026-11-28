import type { SiteSummary } from "../model/site";

export function HomeView({ site }: { site: SiteSummary }) {
  return (
    <html lang='en'>
      <head>
        <meta charset='utf-8' />
        <title>{site.name}</title>
      </head>
      <body>
        <main>
          <h1>{site.name}</h1>
          <p>{site.databaseUp ? "The database is up." : "The database is not answering."}</p>
        </main>
      </body>
    </html>
  );
}
