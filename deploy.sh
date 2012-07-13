#!/bin/bash
ssh webadmin@varium.fantasytalesonline.com "cd tomcat/webapps/ROOT/cleopatra/Gecko-Profiler-Addon&& echo Pull \$PWD && git pull"
ssh bgirard@people.mozilla.org "cd public_html/Gecko-Profiler-Addon && echo Pull \$PWD && git pull"
