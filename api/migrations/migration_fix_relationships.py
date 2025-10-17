# [file name]: migration_fix_relationships.py
from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://admin:password@localhost:5432/deliver")
engine = create_engine(DATABASE_URL)

def run_migration():
    """Run database migration to add new columns and fix relationships"""
    with engine.connect() as conn:
        # Start transaction
        trans = conn.begin()
        
        try:
            # Add new columns to orders table if they don't exist
            columns_to_add = [
                "delivery_fee_cents INTEGER DEFAULT 0",
                "total_cents INTEGER NOT NULL DEFAULT 0", 
                "delivery_address_text TEXT",
                "payment_metadata JSONB",
                "payment_confirmed BOOLEAN DEFAULT FALSE",
                "payment_confirmed_by BIGINT",
                "payment_confirmed_at TIMESTAMP WITH TIME ZONE"
            ]
            
            for column_def in columns_to_add:
                column_name = column_def.split()[0]
                try:
                    # Check if column exists
                    check_sql = text(f"""
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name='orders' AND column_name='{column_name}'
                    """)
                    result = conn.execute(check_sql).fetchone()
                    
                    if not result:
                        # Add column if it doesn't exist
                        alter_sql = text(f"ALTER TABLE orders ADD COLUMN {column_def}")
                        conn.execute(alter_sql)
                        print(f"✅ Added column: {column_name}")
                    else:
                        print(f"✅ Column already exists: {column_name}")
                        
                except Exception as e:
                    print(f"⚠️ Error adding column {column_name}: {e}")
            
            # Create delivery_zones table if it doesn't exist
            create_delivery_zones_sql = text("""
                CREATE TABLE IF NOT EXISTS delivery_zones (
                    id BIGSERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    city VARCHAR(100) NOT NULL,
                    base_fee_cents INTEGER DEFAULT 1000,
                    outside_city_fee_cents INTEGER DEFAULT 2000,
                    polygon_coords JSONB,
                    active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """)
            conn.execute(create_delivery_zones_sql)
            print("✅ Created delivery_zones table")
            
            # Add foreign key constraints if they don't exist
            fk_constraints = [
                ("orders", "customer_id", "customers", "id"),
                ("orders", "delivery_address_id", "customer_addresses", "id"),
                ("orders", "driver_id", "drivers", "id"),
                ("orders", "payment_confirmed_by", "customers", "id"),
                ("customer_addresses", "customer_id", "customers", "id"),
                ("order_events", "order_id", "orders", "id"),
                ("driver_stock", "driver_id", "drivers", "id"),
                ("driver_stock", "menu_item_id", "menu_items", "id"),
                ("driver_stock_events", "driver_id", "drivers", "id"),
                ("driver_stock_events", "menu_item_id", "menu_items", "id"),
                ("driver_stock_events", "order_id", "orders", "id"),
                ("inventory_reservations", "order_id", "orders", "id"),
                ("inventory_reservations", "menu_item_id", "menu_items", "id")
            ]
            
            for table, fk_column, ref_table, ref_column in fk_constraints:
                try:
                    # Check if foreign key exists
                    check_fk_sql = text(f"""
                        SELECT constraint_name 
                        FROM information_schema.table_constraints 
                        WHERE table_name='{table}' 
                        AND constraint_type='FOREIGN KEY'
                        AND constraint_name LIKE '%{fk_column}%'
                    """)
                    result = conn.execute(check_fk_sql).fetchone()
                    
                    if not result:
                        # Add foreign key constraint
                        fk_name = f"fk_{table}_{fk_column}"
                        add_fk_sql = text(f"""
                            ALTER TABLE {table} 
                            ADD CONSTRAINT {fk_name} 
                            FOREIGN KEY ({fk_column}) 
                            REFERENCES {ref_table} ({ref_column})
                        """)
                        conn.execute(add_fk_sql)
                        print(f"✅ Added foreign key: {fk_name}")
                    else:
                        print(f"✅ Foreign key already exists: {table}.{fk_column}")
                        
                except Exception as e:
                    print(f"⚠️ Error adding foreign key for {table}.{fk_column}: {e}")
            
            # Commit transaction
            trans.commit()
            print("🎉 Migration completed successfully!")
            
        except Exception as e:
            # Rollback on error
            trans.rollback()
            print(f"❌ Migration failed: {e}")
            raise

if __name__ == "__main__":
    run_migration()