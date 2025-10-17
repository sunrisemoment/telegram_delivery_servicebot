from aiogram.fsm.state import State, StatesGroup

class OrderStates(StatesGroup):
    waiting_for_phone = State()
    waiting_for_address = State()
    waiting_for_menu_selection = State()
    waiting_for_cart_confirmation = State()
    waiting_for_delivery_type = State()
    waiting_for_payment_method = State()
    waiting_for_slot_selection = State()
    waiting_for_btc_payment = State()
    waiting_for_pickup_address = State()