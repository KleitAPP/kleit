-- Tests for migration 112: the contact form's three new topics are accepted and an unknown one
-- is still refused (the server writes contact rows; the constraint is what the function relies on).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(4);

select lives_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-CTTEST01', 'idea', 'ct', 'ct@example.com', 'An idea') $$, 'server: the idea topic is accepted');
select lives_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-CTTEST02', 'brand', 'ct', 'ct@example.com', 'A brand') $$, 'server: the brand topic is accepted');
select lives_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-CTTEST03', 'legal', 'ct', 'ct@example.com', 'A legal request') $$, 'server: the legal topic is accepted');
select throws_ok($$ insert into contact_messages (request_ref, topic, name, email, message) values ('C-CTTEST04', 'press', 'ct', 'ct@example.com', 'x') $$, '23514', null, 'server: an unknown topic is still refused');

select * from finish();
rollback;
