"""Preserve existing provider data while migrating a pre-unification installation."""
import pathlib
import shutil
import tempfile
import unittest
from pilot import db,ops

class Upgrade(unittest.TestCase):
    def test_upgrade_and_restore_existing_provider(self):
        with tempfile.TemporaryDirectory() as d:
            home=pathlib.Path(d);old=home/'old';old.mkdir()
            for path in pathlib.Path(db.MIGRATIONS_DIR).glob('*.sql'):
                if path.name<'0114':shutil.copy(path,old/path.name)
            path=home/'live.sqlite';con=db.connect(str(path))
            try:
                db.migrate(con,str(old))
                con.execute("INSERT INTO orgs(id,name,created_at) VALUES(?,?,?)",('ACME','Synthetic migration tenant',db.now_iso()))
                applied=db.migrate(con)
                self.assertEqual(len(applied),4)
                self.assertEqual(db.migrate(con),[])
                self.assertEqual(con.execute("SELECT name FROM orgs WHERE id='ACME'").fetchone()[0],'Synthetic migration tenant')
            finally:con.close()
            backup=home/'copy.sqlite'; restore=home/'restored.sqlite'
            ops.backup(str(path),str(backup));ops.restore(str(backup),str(restore))
            con=db.connect(str(restore))
            try:
                self.assertEqual(con.execute("PRAGMA integrity_check").fetchone()[0],'ok')
                self.assertEqual(con.execute("SELECT count(*) FROM orgs WHERE id='ACME'").fetchone()[0],1)
                self.assertEqual(con.execute("SELECT count(*) FROM funding_decision_snapshots").fetchone()[0],0)
            finally:con.close()
