"use client";
import { useDocsSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  TagsList,
  TagsListItem,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useMemo, useState } from "react";

const SECTIONS = [
  { name: "Guides", value: "guides" },
  { name: "API reference", value: "reference" },
];

/**
 * The static search: the browser downloads the index that `next build` wrote to /api/search and searches it locally, so there is no
 * search server. The two filters sit inside the dialog (the stock dialog puts them outside it when tags are used).
 */
export default function UnitfieldSearchDialog(props: SharedProps) {
  const [tag, setTag] = useState<string | undefined>();
  const client = useMemo(() => staticClient({ from: "/api/search", tag }), [tag]);
  const search = useDocsSearch({ client });

  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
        <SearchDialogFooter>
          <TagsList tag={tag} onTagChange={setTag} allowClear>
            {SECTIONS.map((section) => (
              <TagsListItem key={section.value} value={section.value}>
                {section.name}
              </TagsListItem>
            ))}
          </TagsList>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  );
}
