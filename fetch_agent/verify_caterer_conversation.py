"""Used only by verify-caterer-http.mjs on its isolated database branch."""
import asyncio
import json
import os
import re
import sys
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from .caterer import CatererBackend, CatererConversation
from .caterer_bridge import process_message
from .caterer_intents import RuleCatererInterpreter

stage = 'startup'


async def main():
    global stage
    if os.environ.get('CATERER_CONVERSATION_VERIFY') != 'isolated-http-harness':
        raise ValueError('Run node scripts/verify-caterer-http.mjs instead.')
    backend = CatererBackend()
    session = os.environ['CATERER_VERIFY_SESSION']
    token = os.environ['CATERER_INTERNAL_TOKEN']

    async def say(text):
        # A fresh engine on every turn verifies that Neon session state is enough
        # to resume, through the same authenticated handler used by Photon.
        engine = CatererConversation(backend, RuleCatererInterpreter(), interactive_cards=False)
        result = await process_message(SimpleNamespace(token=token, session_id=session, text=text), engine, token)
        assert result['ok']
        return result['text']

    with patch('fetch_agent.caterer_dates.local_today', return_value=date(2099, 7, 5)):
        if sys.argv[1] == 'create':
            stage = 'catalog'
            menu = {item['id']: item for item in (await backend.tool('menu', {}))['items']}
            recipes = (await backend.tool('recipes', {}))['products']
            product = next(p for p in recipes if p['menuItemId'] in menu)
            name = menu[product['menuItemId']]['name']
            stage = 'start-form'
            await say(f'Create an order form for {name} this Saturday.')
            await say('title: Fictional <browser> verification')
            await say('2 boxes, delivery only, orders close Friday at 6')
            stage = 'deadline-clarification'
            response = await say('Fictional demo delivery')
            assert 'AM or PM' in response
            await say('6pm Eastern')
            stage = 'review'
            review = await say('free delivery')
            assert 'Review your order form' in review
            assert '2099-07-11' in review
            draft = (await backend.tool('session', {'sessionId': session}))['draft']
            assert draft['reviewedForm']['products'][0]['expectedUnitPrice'] == menu[product['menuItemId']]['price']
            stage = 'publish'
            reply = await say('publish')
            form_id = re.search(r'/forms/([a-f0-9-]+)', reply)[1]
            print(json.dumps({'formId': form_id, 'productSpecId': product['id']}))
        else:
            stage = 'lookup'
            response = await say('What orders do I have for Saturday?')
            assert 'Fictional Browser Customer' in response
            assert 'REQUESTED' in response
            orders = (await backend.tool('orders', {'start': '2099-07-11', 'end': '2099-07-11'}))['orders']
            assert any(order['formId'] == os.environ['CATERER_VERIFY_FORM'] for order in orders)
            print(json.dumps({'verified': True}))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception:
        # Avoid traceback locals, credentials, database details and customer data.
        print(f'Conversation verification failed at {stage}.', file=sys.stderr)
        sys.exit(1)
