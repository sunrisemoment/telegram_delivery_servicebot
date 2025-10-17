"""Add BTC discount settings

Revision ID: add_btc_discount
Revises: 
Create Date: 2025-10-09

"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    op.create_table(
        'settings',
        sa.Column('id', sa.BigInteger(), primary_key=True, index=True),
        sa.Column('btc_discount_percent', sa.Integer(), default=0),
        sa.Column('updated_by', sa.BigInteger(), sa.ForeignKey('customers.id')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.CheckConstraint('id = 1', name='single_row_check')
    )

def downgrade():
    op.drop_table('settings')