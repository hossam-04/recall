-- Imported cards are their own provenance.
--
-- `source` exists so M5 can ask whether generated cards are retained worse than
-- hand-written ones. An import carries a `source` claim from a file someone
-- else wrote, and nothing here can verify it. Trusting it would drop cards the
-- importer never generated into the `generated` population and quietly bias the
-- only measurement in this project capable of returning a negative result.
--
-- So the server assigns 'imported' and ignores whatever the file says. The two
-- populations M5 compares stay clean, and imported cards sit outside both
-- rather than silently joining one side.

alter table cards drop constraint cards_source_valid;

alter table cards add constraint cards_source_valid
    check (source in ('manual', 'generated', 'imported'));
